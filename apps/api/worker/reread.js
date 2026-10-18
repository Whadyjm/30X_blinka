import { InvoiceDetailSchema, ReevaluateInvoiceSchema } from '@oli/contracts';
import { owner } from './auth.js';
import { audit, body, clearGuard, guard, HttpError, id, json, now, sha256, stmt } from './http.js';
import { enqueueInvoice } from './jobs.js';
import { snapshot } from './processing.js';
import { getInvoice, idempotency } from './repository.js';
import { checkReanalysisLimit } from './reanalysis-limits.js';

export async function rereadInvoice(request, env, session, invoiceId) {
  owner(session);
  const input = await body(request, ReevaluateInvoiceSchema);
  const hash = await sha256(JSON.stringify(input));
  const idem = await idempotency(request, env.DB, session, hash);
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  if (!env.INVOICE_QUEUE) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
  const org = session.organization.id;
  const state = await snapshot(env.DB, org, invoiceId);
  const detail = await getInvoice(env.DB, org, invoiceId);
  if (state.context.policy.id !== input.expectedPolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (detail.latestDecision?.id !== input.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
  if (detail.status !== 'DECIDED' || !state.invoice.extracted_json) throw new HttpError(409, 'INVOICE_NOT_READY');
  const job = await stmt(env.DB, 'SELECT state,attempts FROM invoice_jobs WHERE org_id=? AND invoice_id=?', org, invoiceId).first();
  if (!job || job.attempts >= 3 || job.state === 'DEAD') throw new HttpError(409, 'REANALYSIS_LIMIT_REACHED', 'Se agotaron los intentos de lectura de este documento.');
  if (job.state !== 'DONE') throw new HttpError(409, 'INVOICE_NOT_READY', 'La lectura anterior aún está terminando. Actualiza en unos segundos.');
  if (detail.decisions.some(d => d.action === 'APPROVE') || ['APPROVED', 'REJECTED'].includes(detail.approvalRequest?.state)) {
    throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Una factura ya autorizada o rechazada conserva su resolución.');
  }
  await checkReanalysisLimit(env.DB, org, state.invoice.file_sha256);
  const at = now(), rereadId = id('read'), guardId = id('guard');
  const approvalRequest = detail.approvalRequest?.state === 'PENDING'
    ? { ...detail.approvalRequest, state: 'INVALIDATED', canApprove: false, decidedAt: at } : detail.approvalRequest;
  const response = { data: InvoiceDetailSchema.parse({ ...detail, status: 'RECEIVED', extraction: null, approvalRequest, updatedAt: at }) };
  const facts = Object.fromEntries(['vendor_id','agreement_id','vendor_name','invoice_no','normalized_invoice_no','amount_minor',
    'currency','issued_at','due_date','service_period','description'].map(key => [key, state.invoice[key]]));
  try {
    await env.DB.batch([
      guard(env.DB, org, state.revision, guardId),
      stmt(env.DB, `INSERT INTO invoice_rereads(id,org_id,invoice_id,user_id,expected_decision_id,previous_read_json,previous_facts_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`, rereadId, org, invoiceId, session.user.id, input.expectedDecisionId,
      state.invoice.extracted_json, JSON.stringify(facts), at),
      audit(env.DB, org, session.user.id, 'INVOICE_REEVALUATED', invoiceId, { mode: 'CURRENT_READER_ORIGINAL', rereadId,
        previousDecisionId: input.expectedDecisionId, documentSha256: state.invoice.file_sha256 }, at),
      stmt(env.DB, `UPDATE invoices SET status='RECEIVED',extracted_json=NULL,processing_error_json=NULL,updated_at=?
        WHERE org_id=? AND id=?`, at, org, invoiceId),
      stmt(env.DB, `UPDATE invoice_jobs SET state='PENDING',lease_token=NULL,lease_until=NULL,next_attempt_at=?,
        enqueued_at=NULL,last_error_json=NULL,updated_at=? WHERE org_id=? AND invoice_id=?`, at, at, org, invoiceId),
      stmt(env.DB, `UPDATE approval_requests SET state='INVALIDATED',decided_at=? WHERE org_id=? AND invoice_id=? AND state='PENDING'`, at, org, invoiceId),
      idem.save(response, 202), clearGuard(env.DB, guardId),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, hash);
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/REANALYSIS_LIMIT_REACHED|REANALYSIS_COOLDOWN/.test(String(error))) await checkReanalysisLimit(env.DB, org, state.invoice.file_sha256);
    if (/REREAD_NOT_ALLOWED|CHECK constraint|UNIQUE constraint|INVOICE_FACTS_IMMUTABLE|JOB_TERMINAL/.test(String(error))) {
      throw new HttpError(409, 'DECISION_CHANGED', 'La factura cambió o ya fue resuelta. Actualiza antes de volver a leerla.');
    }
    throw error;
  }
  // The transaction records durable intent; the scheduler recovers a failed queue publication.
  await enqueueInvoice(env, org, invoiceId);
  return json(response, 202);
}

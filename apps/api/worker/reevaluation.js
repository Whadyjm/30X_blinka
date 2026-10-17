import { InvoiceDetailSchema, ReevaluateInvoiceSchema } from '@oli/contracts';
import { owner } from './auth.js';
import { READER_VERSION } from './document.js';
import { audit, body, clearGuard, guard, HttpError, id, json, now, sha256, stmt } from './http.js';
import { decisionStatements, evaluateStored, snapshot } from './processing.js';
import { getInvoice, idempotency } from './repository.js';
import { legacyNegativeDocumentType } from './legacy-document-type.js';

export async function reevaluateInvoice(request, env, session, invoiceId) {
  owner(session);
  const input = await body(request, ReevaluateInvoiceSchema);
  const idem = await idempotency(request, env.DB, session, await sha256(JSON.stringify(input)));
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const org = session.organization.id;
  const state = await snapshot(env.DB, org, invoiceId);
  const detail = await getInvoice(env.DB, org, invoiceId);
  if (state.context.policy.id !== input.expectedPolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (detail.latestDecision?.id !== input.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
  const resolved = await stmt(env.DB, `SELECT 1 AS yes FROM budget_reservations WHERE org_id=? AND invoice_id=?
    UNION ALL SELECT 1 FROM approval_requests WHERE org_id=? AND invoice_id=? AND state IN ('APPROVED','REJECTED') LIMIT 1`,
  org, invoiceId, org, invoiceId).first();
  if (resolved) throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'La factura ya fue autorizada o rechazada por una persona. Se conserva su resolución.');
  if (detail.status !== 'DECIDED' || !state.invoice.extracted_json) {
    throw new HttpError(409, 'INVOICE_NOT_READY', 'La factura necesita una lectura completa antes de reevaluar sus reglas.');
  }
  const read = JSON.parse(state.invoice.extracted_json);
  const legacyClassification = legacyNegativeDocumentType(read, state.invoice.file_sha256);
  if (legacyClassification) {
    read.documentType = legacyClassification.documentType;
    read.provenance = { ...read.provenance, documentClassification: legacyClassification };
  }
  // Reusing old facts must not bypass newer extraction safeguards or erase model uncertainty.
  if (read.provenance?.configVersion !== READER_VERSION) {
    read.extraction.extractionWarnings.push('LEGACY_EXTRACTION_REQUIRES_NEW_READ');
  }
  const evaluation = evaluateStored(read, state);
  if (read.documentType === 'INVOICE'
    && (evaluation.vendorId !== state.invoice.vendor_id || evaluation.agreementId !== state.invoice.agreement_id)) {
    throw new HttpError(409, 'INVOICE_IDENTITY_CHANGED', 'Confirma el proveedor y el acuerdo desde el flujo de alta antes de reevaluar esta factura.');
  }
  const at = now(), approvalId = id('apr'), guardId = id('guard'), roleGuard = id('guard');
  const previousApproval = detail.approvalRequest?.state === 'PENDING'
    ? { ...detail.approvalRequest, state: 'INVALIDATED', canApprove: false, decidedAt: at } : detail.approvalRequest;
  const approvalRequest = evaluation.candidate.needsHumanApproval ? {
    id: approvalId, invoiceId, decisionId: evaluation.candidate.id, policyVersionId: evaluation.candidate.policyVersionId,
    state: 'PENDING', reason: evaluation.candidate.humanExplanation, canApprove: true, reviewerId: null,
    reviewComment: null, createdAt: evaluation.candidate.checkedAt, decidedAt: null,
  } : previousApproval;
  const response = { data: InvoiceDetailSchema.parse({ ...detail, latestDecision: evaluation.candidate,
    decisions: [...detail.decisions, evaluation.candidate], approvalRequest, updatedAt: evaluation.candidate.checkedAt }) };
  try {
    await env.DB.batch([
      guard(env.DB, org, state.revision, guardId),
      stmt(env.DB, `INSERT INTO commit_guards(id,valid) VALUES (?, EXISTS(
        SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role='OWNER'))`, roleGuard, org, session.user.id),
      stmt(env.DB, `UPDATE approval_requests SET state='INVALIDATED', decided_at=?
        WHERE org_id=? AND invoice_id=? AND state='PENDING'`, at, org, invoiceId),
      ...decisionStatements(env.DB, org, evaluation, read, session.user.id, approvalId),
      audit(env.DB, org, session.user.id, 'INVOICE_REEVALUATED', invoiceId, {
        previousDecisionId: input.expectedDecisionId, decisionId: evaluation.candidate.id,
        mode: 'CURRENT_RULES_STORED_EXTRACTION',
        documentType: read.documentType ?? null,
        documentClassificationSource: read.provenance?.documentClassification?.source ?? null,
      }),
      idem.save(response), clearGuard(env.DB, guardId), clearGuard(env.DB, roleGuard),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, await sha256(JSON.stringify(input)));
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/CHECK constraint|UNIQUE constraint|BUDGET_EXCEEDED|POLICY_CHANGED/.test(String(error))) {
      throw new HttpError(409, 'DECISION_CHANGED', 'Los datos cambiaron. Actualiza la factura antes de reanalizarla.');
    }
    throw error;
  }
  return json(response);
}

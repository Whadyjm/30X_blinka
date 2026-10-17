import { MAX_INVOICE_BYTES, ReviewApprovalSchema } from '@oli/contracts';
import { audit, body, clearGuard, guard, HttpError, id, json, now, readBytes, sha256, stmt } from './http.js';
import { getInvoice, idempotency } from './repository.js';
import { validateDocument } from './document.js';
import { enqueueInvoice } from './jobs.js';
import { decisionStatements, evaluateStored, snapshot } from './processing.js';

export async function uploadInvoice(request, env, session) {
  // Bound multipart overhead before asking the runtime to parse it.
  const bytes = await readBytes(request, MAX_INVOICE_BYTES + 65536);
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData(); }
  catch { throw new HttpError(400, 'VALIDATION_ERROR'); }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'file' || typeof entries[0][1] === 'string') throw new HttpError(400, 'VALIDATION_ERROR', 'Envía únicamente el campo file.');
  const file = entries[0][1];
  return receiveInvoice(request, env, session, file);
}

// sourceEventId is server-owned metadata, never a multipart or JSON field.
export async function receiveInvoice(request, env, session, file, sourceEventId = null) {
  const emailSource = sourceEventId?.kind === 'EMAIL' ? sourceEventId : null;
  if (!file.size || file.size > MAX_INVOICE_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE');
  const content = new Uint8Array(await file.arrayBuffer()); validateDocument(content, file.type);
  const name = file.name.normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200) || 'invoice';
  const hash = await sha256(content);
  const requestHash = await sha256(JSON.stringify({ name, mimeType: file.type, size: file.size, hash,
    ...(sourceEventId !== null ? { sourceEventId } : {}) }));
  const idem = await idempotency(request, env.DB, session, requestHash);
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const invoiceId = id('inv'); const orgId = session.organization.id;
  const key = `uploads/${orgId}/${invoiceId}/original`;
  const time = now();
  const data = { id: invoiceId, status: 'RECEIVED', source: emailSource ? 'EMAIL' : sourceEventId === null ? 'HUMAN_UPLOAD' : 'TELEGRAM',
    file: { name, mimeType: file.type, sizeBytes: file.size, url: `/api/v1/invoices/${invoiceId}/file` },
    vendorId: null, vendorName: null, agreementId: null, invoiceNumber: null, amountMinor: null, currency: null,
    issuedAt: null, dueDate: null, servicePeriod: null, description: null, extractionWarnings: [], latestDecision: null,
    approvalRequest: null, processingError: null, createdAt: time, updatedAt: time };
  const response = { data };
  await env.INVOICES.put(key, content, { httpMetadata: { contentType: file.type }, customMetadata: { sha256: hash } });
  const emailGuard = emailSource ? id('guard') : null;
  try {
    await env.DB.batch([
      ...(emailSource ? [stmt(env.DB, `INSERT INTO commit_guards(id,valid) VALUES (?, EXISTS(
        SELECT 1 FROM email_attachments a JOIN email_messages e ON e.org_id = a.org_id AND e.id = a.message_id
        JOIN email_mailboxes m ON m.org_id = e.org_id AND m.id = e.mailbox_id
        WHERE a.id = ? AND a.org_id = ? AND a.sha256 = ? AND a.mime_type = ? AND a.size_bytes = ?
        AND m.user_id = ? AND m.enabled = 1))`, emailGuard, emailSource.attachmentId, orgId, hash, file.type, file.size, session.user.id)] : []),
      stmt(env.DB, `INSERT INTO invoices(id, org_id, file_key, file_name, file_mime_type, file_size_bytes, file_sha256, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, invoiceId, orgId, key, name, file.type, file.size, hash, time, time),
      ...(emailSource ? [stmt(env.DB, 'INSERT INTO email_invoice_sources(org_id,invoice_id,attachment_id) VALUES (?,?,?)', orgId, invoiceId, emailSource.attachmentId)]
        : sourceEventId === null ? [] : [stmt(env.DB,
          "INSERT INTO invoice_sources(org_id, invoice_id, kind, telegram_update_id) VALUES (?, ?, 'TELEGRAM', ?)", orgId, invoiceId, sourceEventId)]),
      audit(env.DB, orgId, emailSource ? null : session.user.id, 'INVOICE_RECEIVED', invoiceId,
        { documentSha256: hash, sizeBytes: file.size, source: data.source,
          ...(emailSource ? { emailAttachmentId: emailSource.attachmentId } : sourceEventId === null ? {} : { telegramUpdateId: sourceEventId }) }, time),
      idem.save(response, 201),
      ...(emailGuard ? [clearGuard(env.DB, emailGuard)] : []),
    ]);
  } catch (error) {
    await env.INVOICES.delete(key);
    const replay = await idempotency(request, env.DB, session, requestHash);
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    throw error;
  }
  // The trigger has committed the processing intent. A publication failure is recovered by the scheduler.
  if (env.INVOICE_QUEUE) {
    try { await enqueueInvoice(env, orgId, invoiceId); }
    catch (error) { console.error(JSON.stringify({ event: 'invoice_initial_dispatch_deferred', invoiceId, code: error instanceof HttpError ? error.code : 'SERVICE_UNAVAILABLE' })); }
  }
  return json(response, 201);
}

export async function invoiceFile(env, orgId, invoiceId) {
  const row = await stmt(env.DB, 'SELECT file_key, file_name, file_mime_type FROM invoices WHERE org_id = ? AND id = ?', orgId, invoiceId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  const object = await env.INVOICES.get(row.file_key);
  if (!object) throw new HttpError(404, 'NOT_FOUND');
  return new Response(object.body, { headers: { 'Content-Type': row.file_mime_type, 'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="invoice"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff' } });
}

export async function reviewApproval(request, env, session, approvalId) {
  const input = await body(request, ReviewApprovalSchema);
  const requestHash = await sha256(JSON.stringify(input));
  const idem = await idempotency(request, env.DB, session, requestHash);
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const orgId = session.organization.id;
  const pending = await stmt(env.DB, 'SELECT * FROM approval_requests WHERE org_id = ? AND id = ?', orgId, approvalId).first();
  if (!pending) throw new HttpError(404, 'NOT_FOUND');
  if (pending.policy_version_id !== input.expectedPolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (pending.decision_id !== input.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
  const state = await snapshot(env.DB, orgId, pending.invoice_id);
  if (state.context.policy.id !== input.expectedPolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (pending.state !== 'PENDING') throw new HttpError(409, 'APPROVAL_NOT_ALLOWED');
  const detail = await getInvoice(env.DB, orgId, pending.invoice_id);
  if (detail.latestDecision?.id !== input.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
  const storedRead = JSON.parse(state.invoice.extracted_json);
  const evaluation = evaluateStored(storedRead, state);
  const authorizable = evaluation.candidate.needsHumanApproval
    && evaluation.vendorId === state.invoice.vendor_id && evaluation.agreementId === state.invoice.agreement_id;
  if (evaluation.vendorId !== state.invoice.vendor_id || evaluation.agreementId !== state.invoice.agreement_id) {
    evaluation.candidate = { ...evaluation.candidate, action: evaluation.candidate.action === 'BLOCK' ? 'BLOCK' : 'ESCALATE', needsHumanApproval: false,
      reasons: [...new Set([...evaluation.candidate.reasons.filter(r => r !== 'POLICY_ALLOWED'), 'AGREEMENT_MISMATCH'])],
      humanExplanation: 'La identidad del proveedor o acuerdo cambió desde la extracción. Se requiere un documento corregido.',
      trace: [...evaluation.candidate.trace, { rule: 'STORED_IDENTITY', outcome: 'ESCALATE',
        explanation: 'La factura decidida conserva su identidad original; no se reasigna con una excepción humana.',
        evidence: { storedVendorId: state.invoice.vendor_id, storedAgreementId: state.invoice.agreement_id } }] };
  }
  const guardId = id('guard');
  if (input.action === 'APPROVE' && !authorizable) {
    // Record the current reason instead of allowing an old UI button to override it.
    try {
      await env.DB.batch([guard(env.DB, orgId, state.revision, guardId),
        stmt(env.DB, "UPDATE approval_requests SET state = 'INVALIDATED', decided_at = ? WHERE org_id = ? AND id = ?", now(), orgId, approvalId),
        ...decisionStatements(env.DB, orgId, evaluation, storedRead),
        audit(env.DB, orgId, session.user.id, 'APPROVAL_INVALIDATED', approvalId, { currentDecisionId: evaluation.candidate.id }),
        clearGuard(env.DB, guardId)]);
    } catch (error) { if (!/CHECK constraint failed: valid/.test(String(error))) throw error; }
    throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Las condiciones cambiaron. Revisa la decisión actual.');
  }
  const approved = input.action === 'APPROVE';
  const decision = { ...evaluation.candidate, action: approved ? 'APPROVE' : 'BLOCK',
    reasons: [approved ? 'HUMAN_APPROVED' : 'HUMAN_REJECTED'], needsHumanApproval: false,
    actor: { kind: 'HUMAN', userId: session.user.id },
    humanExplanation: `${approved ? 'Aprobación simulada autorizada' : 'Solicitud rechazada'} por una persona: ${input.comment}`,
    trace: [...evaluation.candidate.trace, { rule: 'HUMAN_REVIEW', outcome: approved ? 'PASS' : 'BLOCK',
      explanation: input.comment, evidence: { userId: session.user.id, previousDecisionId: pending.decision_id } }] };
  evaluation.candidate = decision;
  const reviewed = { ...detail.approvalRequest, state: approved ? 'APPROVED' : 'REJECTED', canApprove: false,
    reviewerId: session.user.id, reviewComment: input.comment, decidedAt: decision.checkedAt };
  const invoice = { ...detail, latestDecision: decision, approvalRequest: reviewed, updatedAt: decision.checkedAt,
    decisions: [...detail.decisions, decision] };
  const response = { data: { approval: reviewed, invoice } };
  try {
    await env.DB.batch([
      guard(env.DB, orgId, state.revision, guardId),
      ...decisionStatements(env.DB, orgId, evaluation, storedRead, session.user.id),
      stmt(env.DB, `UPDATE approval_requests SET state = ?, reviewer_id = ?, review_comment = ?, decided_at = ?
        WHERE id = ? AND org_id = ? AND state = 'PENDING'`, reviewed.state, session.user.id, input.comment, reviewed.decidedAt, approvalId, orgId),
      audit(env.DB, orgId, session.user.id, 'APPROVAL_REVIEWED', approvalId, { decisionId: decision.id, comment: input.comment }),
      idem.save(response), clearGuard(env.DB, guardId),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, requestHash);
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/CHECK constraint failed: valid|UNIQUE constraint failed: budget_reservations|BUDGET_EXCEEDED|POLICY_CHANGED/.test(String(error))) {
      throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Las condiciones cambiaron. Recarga la factura.');
    }
    throw error;
  }
  return json(response);
}

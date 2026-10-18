import { ConfirmInvoiceReviewSchema, HumanExtractionReviewSchema, InvoiceDetailSchema } from '@oli/contracts';
import { audit, body, clearGuard, guard, HttpError, id, json, now, sha256, stmt } from './http.js';
import { decisionStatements, evaluateStored, snapshot } from './processing.js';
import { getInvoice, idempotency } from './repository.js';

export async function confirmInvoiceReview(request, env, session, invoiceId) {
  if (!['OWNER', 'APPROVER'].includes(session.role)) throw new HttpError(403, 'FORBIDDEN');
  const input = await body(request, ConfirmInvoiceReviewSchema);
  const hash = await sha256(JSON.stringify(input));
  const idem = await idempotency(request, env.DB, session, hash);
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const org = session.organization.id;
  const state = await snapshot(env.DB, org, invoiceId);
  const detail = await getInvoice(env.DB, org, invoiceId);
  if (state.context.policy.id !== input.expectedPolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (detail.latestDecision?.id !== input.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
  if (detail.status !== 'DECIDED' || !state.invoice.extracted_json) throw new HttpError(409, 'INVOICE_NOT_READY');
  if (detail.decisions.some(d => d.action === 'APPROVE') || ['APPROVED', 'REJECTED'].includes(detail.approvalRequest?.state)) {
    throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Esta factura ya tiene una resolución registrada.');
  }
  const read = JSON.parse(state.invoice.extracted_json);
  if (read.documentType !== 'INVOICE') throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Primero hace falta confirmar que el documento es una factura.');
  const humanReview = HumanExtractionReviewSchema.parse({ id: id('review'), reviewerId: session.user.id,
    documentSha256: state.invoice.file_sha256, primaryReadId: read.primaryReadId, extraction: read.extraction });
  if (['vendorName', 'amountMinor', 'currency', 'dueDate'].some(field => humanReview.extraction[field] === null)) {
    throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Faltan datos necesarios. Corrige proveedor, monto, moneda o vencimiento antes de confirmar.');
  }
  // A human attestation never impersonates an OCR result; all spending rules run again.
  const reviewedRead = { ...read, humanReview };
  const evaluation = evaluateStored(reviewedRead, state);
  const canApprove = evaluation.candidate.action === 'APPROVE' || evaluation.candidate.needsHumanApproval;
  const candidate = evaluation.candidate;
  evaluation.candidate = { ...candidate, ...(canApprove ? { action: 'APPROVE', reasons: ['HUMAN_APPROVED'] } : {}),
    needsHumanApproval: false, actor: { kind: 'HUMAN', userId: session.user.id },
    humanExplanation: canApprove ? `Factura autorizada por una persona después de revisar sus datos: ${input.comment}` : candidate.humanExplanation,
    trace: [...candidate.trace, { rule: 'HUMAN_DATA_REVIEW', outcome: 'PASS',
      explanation: 'Una persona confirmó los datos del documento. Los controles de gasto se evaluaron por separado.',
      evidence: { reviewId: humanReview.id, reviewerId: session.user.id, previousDecisionId: input.expectedDecisionId, comment: input.comment } }] };
  const at = now(), guardId = id('guard'), roleGuard = id('guard');
  const previousApproval = detail.approvalRequest?.state === 'PENDING'
    ? { ...detail.approvalRequest, state: 'INVALIDATED', canApprove: false, decidedAt: at } : detail.approvalRequest;
  const response = { data: InvoiceDetailSchema.parse({ ...detail, vendorId: evaluation.vendorId, agreementId: evaluation.agreementId,
    latestDecision: evaluation.candidate, decisions: [...detail.decisions, evaluation.candidate],
    approvalRequest: previousApproval, updatedAt: evaluation.candidate.checkedAt }) };
  try {
    await env.DB.batch([
      guard(env.DB, org, state.revision, guardId),
      stmt(env.DB, `INSERT INTO commit_guards(id,valid) VALUES (?,EXISTS(
        SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role IN ('OWNER','APPROVER')))`, roleGuard, org, session.user.id),
      stmt(env.DB, `INSERT INTO invoice_manual_reviews(id,org_id,invoice_id,user_id,previous_decision_id,policy_version_id,
        previous_read_json,review_json,comment,vendor_id,agreement_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      humanReview.id, org, invoiceId, session.user.id, input.expectedDecisionId, input.expectedPolicyVersionId,
      state.invoice.extracted_json, JSON.stringify(humanReview), input.comment, evaluation.vendorId, evaluation.agreementId, at),
      stmt(env.DB, 'UPDATE invoices SET vendor_id=?,agreement_id=? WHERE org_id=? AND id=?', evaluation.vendorId, evaluation.agreementId, org, invoiceId),
      stmt(env.DB, "UPDATE approval_requests SET state='INVALIDATED',decided_at=? WHERE org_id=? AND invoice_id=? AND state='PENDING'", at, org, invoiceId),
      ...decisionStatements(env.DB, org, evaluation, reviewedRead, session.user.id),
      audit(env.DB, org, session.user.id, 'INVOICE_MANUALLY_REVIEWED', invoiceId,
        { reviewId: humanReview.id, previousDecisionId: input.expectedDecisionId, decisionId: evaluation.candidate.id, approved: canApprove, comment: input.comment }),
      idem.save(response), clearGuard(env.DB, guardId), clearGuard(env.DB, roleGuard),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, hash);
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/CHECK constraint|UNIQUE constraint|MANUAL_REVIEW_NOT_ALLOWED|BUDGET_EXCEEDED|POLICY_CHANGED/.test(String(error))) {
      throw new HttpError(409, 'APPROVAL_NOT_ALLOWED', 'Los datos o las reglas cambiaron. Actualiza la factura antes de aprobarla.');
    }
    throw error;
  }
  return json(response);
}

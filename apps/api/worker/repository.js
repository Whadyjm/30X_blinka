import { ApprovalRequestSchema, BudgetPeriodSchema, InvoiceDetailSchema, InvoiceSchema,
  PolicyDecisionSchema, PolicyVersionSchema, VendorSchema, AgreementSchema } from '@oli/contracts';
import { HttpError, stmt } from './http.js';

export const vendorDto = r => VendorSchema.parse({ id: r.id, name: r.name, allowed: !!r.allowed, externalRef: r.external_ref, createdAt: r.created_at });
export const agreementDto = r => AgreementSchema.parse({ id: r.id, vendorId: r.vendor_id, currency: r.currency,
  amountMinor: r.amount_minor, toleranceMinor: r.tolerance_minor, frequency: r.frequency,
  concept: r.concept, active: !!r.active, createdAt: r.created_at });
export const policyDto = r => r ? PolicyVersionSchema.parse({ id: r.id, version: r.version, status: r.status,
  rules: JSON.parse(r.policy_json), activatedAt: r.created_at, activatedBy: r.created_by }) : null;
export const budgetDto = r => BudgetPeriodSchema.parse({ id: r.id, currency: r.currency, periodKey: r.period_key,
  limitMinor: r.limit_minor, reservedMinor: r.reserved_minor, availableMinor: r.limit_minor - r.reserved_minor });
export const decisionDto = r => PolicyDecisionSchema.parse(JSON.parse(r.evidence_json).decision);
export function approvalDto(r, activePolicyId = null) {
  return r ? ApprovalRequestSchema.parse({ id: r.id, invoiceId: r.invoice_id, decisionId: r.decision_id,
    policyVersionId: r.policy_version_id, state: r.state, reason: r.reason,
    canApprove: r.state === 'PENDING' && r.policy_version_id === activePolicyId,
    reviewerId: r.reviewer_id, reviewComment: r.review_comment, createdAt: r.created_at, decidedAt: r.decided_at }) : null;
}
export function invoiceDto(row, decisions, approvals, activePolicyId, detail = false) {
  const data = { id: row.id, status: row.status, source: row.source_kind,
    file: { name: row.file_name, mimeType: row.file_mime_type, sizeBytes: row.file_size_bytes,
      url: `/api/v1/invoices/${encodeURIComponent(row.id)}/file` },
    vendorId: row.vendor_id, vendorName: row.vendor_name, agreementId: row.agreement_id,
    invoiceNumber: row.invoice_no, amountMinor: row.amount_minor, currency: row.currency,
    issuedAt: row.issued_at, dueDate: row.due_date, servicePeriod: row.service_period, description: row.description,
    extractionWarnings: JSON.parse(row.extraction_warnings_json),
    latestDecision: decisions.length ? decisionDto(decisions.at(-1)) : null,
    approvalRequest: approvalDto(approvals.at(-1), activePolicyId),
    processingError: row.processing_error_json ? JSON.parse(row.processing_error_json) : null,
    createdAt: row.created_at, updatedAt: row.updated_at };
  return detail ? InvoiceDetailSchema.parse({ ...data,
    extraction: row.extracted_json ? JSON.parse(row.extracted_json).extraction : null,
    decisions: decisions.map(decisionDto) }) : InvoiceSchema.parse(data);
}
export async function getInvoice(db, orgId, invoiceId, detail = true) {
  const result = await db.batch([
    stmt(db, 'SELECT * FROM invoices WHERE org_id = ? AND id = ?', orgId, invoiceId),
    stmt(db, 'SELECT * FROM decisions WHERE org_id = ? AND invoice_id = ? ORDER BY created_at, rowid', orgId, invoiceId),
    stmt(db, 'SELECT * FROM approval_requests WHERE org_id = ? AND invoice_id = ? ORDER BY created_at, rowid', orgId, invoiceId),
    stmt(db, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId),
  ]);
  const row = result[0].results[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return invoiceDto(row, result[1].results, result[2].results, result[3].results[0]?.id, detail);
}
export async function invoiceRows(db, orgId) {
  const results = await db.batch([
    stmt(db, 'SELECT * FROM invoices WHERE org_id = ? ORDER BY created_at DESC, id DESC', orgId),
    stmt(db, 'SELECT * FROM decisions WHERE org_id = ? ORDER BY created_at, rowid', orgId),
    stmt(db, 'SELECT * FROM approval_requests WHERE org_id = ? ORDER BY created_at, rowid', orgId),
    stmt(db, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId),
  ]);
  return results[0].results.map(row => invoiceDto(row,
    results[1].results.filter(d => d.invoice_id === row.id), results[2].results.filter(a => a.invoice_id === row.id), results[3].results[0]?.id));
}

export async function idempotency(request, db, session, requestHash) {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  const route = `${request.method} ${new URL(request.url).pathname}`;
  const args = [session.organization.id, session.user.id, route, key];
  const cached = await stmt(db, 'SELECT * FROM idempotency_keys WHERE org_id = ? AND actor_id = ? AND route = ? AND key = ?', ...args).first();
  if (cached && cached.request_hash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
  return { cached: cached ? { body: JSON.parse(cached.response_json), status: cached.response_status } : null,
    save: (response, status = 200) => stmt(db, `INSERT INTO idempotency_keys
      (org_id, actor_id, route, key, request_hash, state, response_status, response_json)
      VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`, ...args, requestHash, status, JSON.stringify(response)) };
}

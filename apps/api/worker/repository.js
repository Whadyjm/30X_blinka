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
  const data = { id: row.id, status: row.status, source: row.channel_kind ?? row.source_kind,
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
    stmt(db, `SELECT i.*, s.kind AS channel_kind FROM invoices i LEFT JOIN invoice_channel_sources s
      ON s.org_id = i.org_id AND s.invoice_id = i.id WHERE i.org_id = ? AND i.id = ?`, orgId, invoiceId),
    stmt(db, 'SELECT * FROM decisions WHERE org_id = ? AND invoice_id = ? ORDER BY created_at, rowid', orgId, invoiceId),
    stmt(db, 'SELECT * FROM approval_requests WHERE org_id = ? AND invoice_id = ? ORDER BY created_at, rowid', orgId, invoiceId),
    stmt(db, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId),
  ]);
  const row = result[0].results[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return invoiceDto(row, result[1].results, result[2].results, result[3].results[0]?.id, detail);
}
export async function invoiceRows(db, orgId) {
  const rows = (await stmt(db, `SELECT ${invoiceColumns} FROM invoices i ${invoiceJoins}
    WHERE i.org_id = ? ORDER BY i.created_at DESC, i.id DESC`, orgId).all()).results;
  return rows.map(joinedInvoiceDto);
}

// Insertion order breaks timestamp ties, matching getInvoice's append-only history.
const invoiceJoins = `LEFT JOIN invoice_channel_sources s ON s.org_id = i.org_id AND s.invoice_id = i.id
  LEFT JOIN decisions d ON d.rowid = (SELECT rowid FROM decisions
    WHERE org_id = i.org_id AND invoice_id = i.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
  LEFT JOIN approval_requests a ON a.rowid = (SELECT rowid FROM approval_requests
    WHERE org_id = i.org_id AND invoice_id = i.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
  LEFT JOIN policy_versions p ON p.org_id = i.org_id AND p.status = 'ACTIVE'`;
const invoiceColumns = `i.id, i.status, i.source_kind, i.file_name, i.file_mime_type, i.file_size_bytes,
  i.vendor_id, i.vendor_name, i.agreement_id, i.invoice_no, i.amount_minor, i.currency, i.issued_at,
  i.due_date, i.service_period, i.description, i.extraction_warnings_json, i.processing_error_json,
  i.created_at, i.updated_at, s.kind AS channel_kind, d.evidence_json AS latest_decision_json,
  p.id AS active_policy_id, CASE WHEN a.id IS NULL THEN NULL ELSE json_object(
    'id', a.id, 'invoice_id', a.invoice_id, 'decision_id', a.decision_id, 'policy_version_id', a.policy_version_id,
    'state', a.state, 'reason', a.reason, 'reviewer_id', a.reviewer_id, 'review_comment', a.review_comment,
    'created_at', a.created_at, 'decided_at', a.decided_at) END AS latest_approval_json`;
const pendingApproval = "coalesce(a.state = 'PENDING' AND a.policy_version_id = p.id, 0)";
function joinedInvoiceDto(row) {
  return invoiceDto(row, row.latest_decision_json ? [{ evidence_json: row.latest_decision_json }] : [],
    row.latest_approval_json ? [JSON.parse(row.latest_approval_json)] : [], row.active_policy_id);
}
const pagination = (q, total) => ({ page: q.page, pageSize: q.pageSize, total });
function invoiceFilter(orgId, q) {
  const clauses = ['i.org_id = ?']; const values = [orgId];
  for (const [key, column] of [['status', 'i.status'], ['action', 'd.action'], ['vendorId', 'i.vendor_id']]) {
    if (q[key] !== undefined) { clauses.push(`${column} = ?`); values.push(q[key]); }
  }
  if (q.needsHumanApproval !== undefined) { clauses.push(`${pendingApproval} = ?`); values.push(Number(q.needsHumanApproval)); }
  return { where: clauses.join(' AND '), values };
}
export async function invoicePage(db, orgId, q) {
  const { where, values } = invoiceFilter(orgId, q);
  const results = await db.batch([
    stmt(db, `SELECT count(*) AS total FROM invoices i ${invoiceJoins} WHERE ${where}`, ...values),
    stmt(db, `SELECT ${invoiceColumns} FROM invoices i ${invoiceJoins} WHERE ${where}
      ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`, ...values, q.pageSize, (q.page - 1) * q.pageSize),
  ]);
  return { data: results[1].results.map(joinedInvoiceDto), pagination: pagination(q, results[0].results[0].total) };
}
export async function approvalPage(db, orgId, q) {
  const results = await db.batch([
    stmt(db, 'SELECT count(*) AS total FROM approval_requests WHERE org_id = ? AND state = ?', orgId, q.state),
    stmt(db, `SELECT ${invoiceColumns},
      json_object('id', r.id, 'invoice_id', r.invoice_id, 'decision_id', r.decision_id, 'policy_version_id', r.policy_version_id,
        'state', r.state, 'reason', r.reason, 'reviewer_id', r.reviewer_id, 'review_comment', r.review_comment,
        'created_at', r.created_at, 'decided_at', r.decided_at) AS requested_approval_json
      FROM approval_requests r JOIN invoices i ON i.org_id = r.org_id AND i.id = r.invoice_id ${invoiceJoins}
      WHERE r.org_id = ? AND r.state = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    orgId, q.state, q.pageSize, (q.page - 1) * q.pageSize),
  ]);
  return { data: results[1].results.map(row => ({ approval: approvalDto(JSON.parse(row.requested_approval_json), row.active_policy_id),
    invoice: joinedInvoiceDto(row) })), pagination: pagination(q, results[0].results[0].total) };
}
export async function dashboardInvoiceData(db, orgId, today) {
  const results = await db.batch([
    stmt(db, `SELECT count(*) AS total,
      coalesce(sum(d.action = 'APPROVE'), 0) AS approved, coalesce(sum(d.action = 'BLOCK'), 0) AS blocked,
      coalesce(sum(d.action = 'ESCALATE'), 0) AS escalated, coalesce(sum(${pendingApproval}), 0) AS needsHumanApproval,
      coalesce(sum(i.status IN ('RECEIVED', 'PARSING', 'READY', 'PROCESSING')), 0) AS processing,
      coalesce(sum(i.status = 'FAILED'), 0) AS failed FROM invoices i ${invoiceJoins} WHERE i.org_id = ?`, orgId),
    stmt(db, `SELECT ${invoiceColumns} FROM invoices i ${invoiceJoins}
      WHERE i.org_id = ? AND i.due_date >= ? AND (d.action IS NULL OR d.action <> 'BLOCK') AND i.status <> 'FAILED'
      ORDER BY i.due_date, i.created_at DESC, i.id DESC LIMIT 5`, orgId, today),
    stmt(db, 'SELECT * FROM decisions WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10', orgId),
  ]);
  return { counts: results[0].results[0], upcoming: results[1].results.map(joinedInvoiceDto), recentDecisions: results[2].results.map(decisionDto) };
}

export function snapshotInvoicesStatement(db, orgId, invoiceId) {
  // Necessary predicates only: Unicode/concept/vendor checks remain in the domain. Never LIMIT financial candidates.
  return stmt(db, `WITH target AS (SELECT * FROM invoices WHERE org_id = ? AND id = ?), candidates AS (
    SELECT id FROM target
    UNION SELECT i.id FROM invoices i JOIN target t ON i.org_id = t.org_id AND i.file_sha256 = t.file_sha256
    UNION SELECT i.id FROM invoices i JOIN target t ON i.org_id = t.org_id AND i.normalized_invoice_no = t.normalized_invoice_no
    UNION SELECT i.id FROM invoices i JOIN target t ON i.org_id = t.org_id
      AND i.amount_minor = t.amount_minor AND i.currency = t.currency AND i.issued_at = t.issued_at
    UNION SELECT i.id FROM invoices i JOIN target t ON i.org_id = t.org_id
      JOIN budget_reservations r ON r.org_id = i.org_id AND r.invoice_id = i.id
      JOIN agreements a ON a.org_id = i.org_id AND a.id = i.agreement_id
      WHERE a.frequency = 'ONE_TIME' OR i.service_period = t.service_period
  ) SELECT i.*, EXISTS(SELECT 1 FROM budget_reservations r WHERE r.org_id = i.org_id AND r.invoice_id = i.id) AS reserved
    FROM invoices i JOIN candidates c ON c.id = i.id WHERE i.org_id = ?`, orgId, invoiceId, orgId);
}

export async function idempotency(request, db, session, requestHash) {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  const route = `${request.method} ${new URL(request.url).pathname}${session.agent ? ` @${session.agent.id}` : ''}`;
  const args = [session.organization.id, session.user.id, route, key];
  const cached = await stmt(db, 'SELECT * FROM idempotency_keys WHERE org_id = ? AND actor_id = ? AND route = ? AND key = ?', ...args).first();
  if (cached && cached.request_hash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
  return { cached: cached ? { body: JSON.parse(cached.response_json), status: cached.response_status } : null,
    save: (response, status = 200) => stmt(db, `INSERT INTO idempotency_keys
      (org_id, actor_id, route, key, request_hash, state, response_status, response_json)
      VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`, ...args, requestHash, status, JSON.stringify(response)) };
}

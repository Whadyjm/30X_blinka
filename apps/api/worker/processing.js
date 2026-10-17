import { evaluateInvoice, normalizeInvoiceNumber } from '@oli/domain';
import { ExtractedInvoiceSchema, PolicyDecisionSchema } from '@oli/contracts';
import { ExtractionError } from '@oli/extraction';
import { audit, clearGuard, guard, HttpError, id, now, periodKey, sha256, stmt } from './http.js';
import { agreementDto, budgetDto, getInvoice, policyDto, vendorDto } from './repository.js';
import { readDocument } from './document.js';

const emptyExtraction = () => ExtractedInvoiceSchema.parse({ vendorName: null, invoiceNumber: null, amountMinor: null,
  currency: null, issuedAt: null, dueDate: null, servicePeriod: null, description: null, extractionWarnings: [], evidence: [] });

export async function snapshot(db, orgId, invoiceId, attempt = 0) {
  const results = await db.batch([
    stmt(db, 'SELECT * FROM organizations WHERE id = ?', orgId),
    stmt(db, "SELECT * FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId),
    stmt(db, 'SELECT * FROM vendors WHERE org_id = ?', orgId),
    stmt(db, 'SELECT * FROM agreements WHERE org_id = ?', orgId),
    stmt(db, 'SELECT * FROM budget_periods WHERE org_id = ?', orgId),
    stmt(db, `SELECT i.*, EXISTS(SELECT 1 FROM budget_reservations r WHERE r.org_id = i.org_id AND r.invoice_id = i.id) AS reserved
      FROM invoices i WHERE i.org_id = ?`, orgId),
  ]);
  const org = results[0].results[0];
  const policy = policyDto(results[1].results[0]);
  if (!policy) throw new HttpError(409, 'MANDATE_REQUIRED');
  const invoice = results[5].results.find(i => i.id === invoiceId);
  if (!invoice) throw new HttpError(404, 'NOT_FOUND');
  const key = periodKey(org.timezone);
  const budget = results[4].results.find(b => b.period_key === key && b.currency === policy.rules.currency);
  if (!budget) {
    if (attempt >= 3) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
    const guardId = id('guard');
    try {
      await db.batch([guard(db, orgId, org.state_revision, guardId),
        stmt(db, `INSERT INTO budget_periods(id, org_id, currency, period_key, limit_minor)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(org_id, currency, period_key) DO NOTHING`,
        id('budget'), orgId, policy.rules.currency, key, policy.rules.monthlyBudgetMinor),
        audit(db, orgId, null, 'BUDGET_PERIOD_OPENED', key, { currency: policy.rules.currency, policyVersionId: policy.id }),
        clearGuard(db, guardId)]);
    } catch (error) { if (!/CHECK constraint failed: valid/.test(String(error))) throw error; }
    return snapshot(db, orgId, invoiceId, attempt + 1);
  }
  return { revision: org.state_revision, invoice, context: {
    organizationId: orgId, decisionId: id('dec'), checkedAt: now(), budgetPeriodKey: key, policy,
    vendors: results[2].results.map(vendorDto), agreements: results[3].results.map(agreementDto),
    budget: budget ? budgetDto(budget) : null,
    priorInvoices: results[5].results.filter(i => i.id !== invoiceId).map(i => ({ id: i.id,
      documentSha256: i.file_sha256, vendorId: i.vendor_id, agreementId: i.agreement_id,
      extraction: i.extracted_json ? JSON.parse(i.extracted_json).extraction : emptyExtraction(), reservationActive: !!i.reserved })),
  } };
}

export function decisionStatements(db, orgId, evaluation, storedRead, actorId = null) {
  const d = PolicyDecisionSchema.parse(evaluation.candidate);
  const sql = [stmt(db, `INSERT INTO decisions (id, org_id, invoice_id, action, policy_version_id, budget_period_id,
    reason_codes_json, evidence_json, human_explanation, needs_human_approval, actor_kind, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, d.id, orgId, d.invoiceId, d.action, d.policyVersionId,
    d.action === 'APPROVE' ? evaluation.budgetPeriodId : null, JSON.stringify(d.reasons),
    JSON.stringify({ decision: d, extractionCheck: { documentSha256: storedRead.documentSha256,
      primaryReadId: storedRead.primaryReadId, corroboration: storedRead.corroboration }, provenance: storedRead.provenance }),
    d.humanExplanation, Number(d.needsHumanApproval), d.actor.kind, d.actor.userId, d.checkedAt),
  audit(db, orgId, actorId, 'INVOICE_DECIDED', d.invoiceId, { decisionId: d.id, action: d.action, reasons: d.reasons }, d.checkedAt)];
  if (d.needsHumanApproval) sql.push(stmt(db, `INSERT INTO approval_requests
    (id, org_id, invoice_id, decision_id, policy_version_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id('apr'), orgId, d.invoiceId, d.id, d.policyVersionId, d.humanExplanation, d.checkedAt));
  return sql;
}

export function evaluateStored(read, state) {
  return evaluateInvoice({ id: state.invoice.id, documentSha256: state.invoice.file_sha256,
    primaryReadId: read.primaryReadId, extraction: read.extraction, corroboration: read.corroboration,
    agreementReference: null }, state.context);
}

export async function processInvoice(env, orgId, invoiceId, read = readDocument) {
  const existing = await getInvoice(env.DB, orgId, invoiceId);
  if (existing.status === 'DECIDED') return { data: existing, status: 200 };
  if (existing.status === 'FAILED' && !existing.processingError?.retryable) return { data: existing, status: 200 };
  if (!await stmt(env.DB, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId).first()) throw new HttpError(409, 'MANDATE_REQUIRED');
  const token = id('work'); const time = now();
  const claimed = await stmt(env.DB, `UPDATE invoices SET status = 'PARSING', processing_token = ?, processing_started_at = ?,
    processing_error_json = NULL, updated_at = ? WHERE id = ? AND org_id = ?
    AND (status IN ('RECEIVED', 'FAILED') OR (status IN ('PARSING', 'READY', 'PROCESSING') AND processing_started_at < ?))
    RETURNING *`, token, time, time, invoiceId, orgId, new Date(Date.now() - 120000).toISOString()).first();
  if (!claimed) return { data: await getInvoice(env.DB, orgId, invoiceId), status: 202 };
  try {
    let storedRead = claimed.extracted_json ? JSON.parse(claimed.extracted_json) : null;
    if (!storedRead) {
      const object = await env.INVOICES.get(claimed.file_key);
      if (!object || object.size > 5242880) throw new Error('DOCUMENT_UNAVAILABLE');
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length !== claimed.file_size_bytes || await sha256(bytes) !== claimed.file_sha256) throw new Error('DOCUMENT_INTEGRITY_FAILED');
      storedRead = await read(env, { mimeType: claimed.file_mime_type }, bytes, claimed.file_sha256);
      // The adapter is a server-owned trust boundary, not a route input.
      storedRead.extraction = ExtractedInvoiceSchema.parse(storedRead.extraction);
      if (storedRead.documentSha256 !== claimed.file_sha256) throw new Error('DOCUMENT_INTEGRITY_FAILED');
      const updated = await stmt(env.DB, `UPDATE invoices SET extracted_json = ?, extraction_warnings_json = ?,
        vendor_name = ?, invoice_no = ?, normalized_invoice_no = ?, amount_minor = ?, currency = ?, issued_at = ?,
        due_date = ?, service_period = ?, description = ?, status = 'PROCESSING', updated_at = ?
        WHERE id = ? AND org_id = ? AND processing_token = ? AND status = 'PARSING' RETURNING id`,
      JSON.stringify(storedRead), JSON.stringify(storedRead.extraction.extractionWarnings),
      storedRead.extraction.vendorName, storedRead.extraction.invoiceNumber, normalizeInvoiceNumber(storedRead.extraction.invoiceNumber),
      storedRead.extraction.amountMinor, storedRead.extraction.currency, storedRead.extraction.issuedAt, storedRead.extraction.dueDate,
      storedRead.extraction.servicePeriod, storedRead.extraction.description, now(), invoiceId, orgId, token).first();
      if (!updated) return { data: await getInvoice(env.DB, orgId, invoiceId), status: 202 };
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await snapshot(env.DB, orgId, invoiceId);
      if (state.invoice.status === 'DECIDED') return { data: await getInvoice(env.DB, orgId, invoiceId), status: 200 };
      if (state.invoice.processing_token !== token) return { data: await getInvoice(env.DB, orgId, invoiceId), status: 202 };
      const evaluation = evaluateStored(storedRead, state);
      const guardId = id('guard');
      try {
        await env.DB.batch([
          guard(env.DB, orgId, state.revision, guardId),
          stmt(env.DB, 'UPDATE invoices SET vendor_id = ?, agreement_id = ? WHERE id = ? AND org_id = ?', evaluation.vendorId, evaluation.agreementId, invoiceId, orgId),
          ...decisionStatements(env.DB, orgId, evaluation, storedRead),
          stmt(env.DB, 'UPDATE invoices SET processing_token = NULL, processing_started_at = NULL WHERE id = ? AND org_id = ?', invoiceId, orgId),
          clearGuard(env.DB, guardId),
        ]);
        return { data: await getInvoice(env.DB, orgId, invoiceId), status: 200 };
      } catch (error) {
        if (!/CHECK constraint failed: valid|BUDGET_EXCEEDED|POLICY_CHANGED|UNIQUE constraint failed: budget_reservations/.test(String(error))) throw error;
      }
    }
    throw new Error('CONCURRENT_UPDATE');
  } catch (error) {
    const nonRetryable = error instanceof ExtractionError && ['INVALID_OUTPUT', 'MODEL_REFUSED', 'INVALID_IMAGE', 'INVALID_PDF'].includes(error.code);
    const code = error instanceof ExtractionError ? error.code : error instanceof HttpError ? error.code : 'PROCESSING_FAILED';
    console.error(JSON.stringify({ event: 'invoice_processing_failed', invoiceId, code }));
    await stmt(env.DB, `UPDATE invoices SET status = 'FAILED', processing_error_json = ?, processing_token = NULL,
      processing_started_at = NULL, updated_at = ? WHERE id = ? AND org_id = ? AND processing_token = ? AND status <> 'DECIDED'`,
    JSON.stringify({ code, message: 'No se pudo completar el procesamiento; no se creó una aprobación.', retryable: !nonRetryable }), now(), invoiceId, orgId, token).run();
    return { data: await getInvoice(env.DB, orgId, invoiceId), status: 200 };
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { evaluateInvoice, normalizeInvoiceNumber } from '@oli/domain';
import { agreementDto, approvalPage, budgetDto, dashboardInvoiceData, getInvoice, invoicePage,
  invoiceRows, policyDto, snapshotInvoicesStatement, vendorDto } from '../worker/repository.js';
import { corroboratePdfText } from '../worker/document.js';
import { decisionStatements } from '../worker/processing.js';
import { periodKey, stmt } from '../worker/http.js';

const org = 'org_demo';
const instant = '2026-10-17T12:00:00.000Z';
const extraction = overrides => ({ vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'QUERY-001',
  amountMinor: 20000, currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
  description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [], ...overrides });
const empty = extraction({ vendorName: null, invoiceNumber: null, amountMinor: null, currency: null,
  issuedAt: null, dueDate: null, servicePeriod: null, description: null });
const q = overrides => ({ page: 1, pageSize: 20, ...overrides });

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'query-performance' } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const paths = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => `migrations/${f}`);
  for (const file of [...paths, 'seed/demo.sql']) {
    const parts = readFileSync(new URL(file, root), 'utf8').split('\n-- statement-breakpoint\n').map(s => s.trim()).filter(Boolean);
    await db.batch(parts.map(sql => db.prepare(sql)));
  }
  return db;
}

let sequence = 0;
async function addInvoice(db, invoiceId, overrides = {}, options = {}) {
  const ex = extraction({ invoiceNumber: invoiceId, ...overrides });
  const hash = options.hash ?? (++sequence).toString(16).padStart(64, '0');
  const read = { extraction: ex, documentSha256: hash, primaryReadId: `read_${invoiceId}`,
    corroboration: corroboratePdfText(`EMISOR / SUPPLIER\n${ex.vendorName}\nMoneda / Currency\n${ex.currency}\nVencimiento / Due\n${ex.dueDate}\nTOTAL A COBRAR\n${ex.currency} ${((ex.amountMinor ?? 0) / 100).toFixed(2)}`, hash), provenance: {} };
  await stmt(db, `INSERT INTO invoices(id,org_id,vendor_id,agreement_id,vendor_name,invoice_no,normalized_invoice_no,
    amount_minor,currency,issued_at,due_date,service_period,description,file_key,file_name,file_mime_type,
    file_size_bytes,file_sha256,extracted_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'application/pdf',10,?,?,?,?,?)`, invoiceId, options.org ?? org,
  options.vendor ?? null, options.agreement ?? null, ex.vendorName, ex.invoiceNumber, normalizeInvoiceNumber(ex.invoiceNumber),
  ex.amountMinor, ex.currency, ex.issuedAt, ex.dueDate, ex.servicePeriod, ex.description, `tests/${invoiceId}`, `${invoiceId}.pdf`,
  hash, JSON.stringify(read), options.status ?? 'PROCESSING', options.createdAt ?? instant, instant).run();
  return { id: invoiceId, file_sha256: hash, read, ex };
}
async function context(db, priorInvoices = []) {
  const rows = await db.batch([
    stmt(db, "SELECT * FROM policy_versions WHERE org_id=? AND status='ACTIVE'", org),
    stmt(db, 'SELECT * FROM vendors WHERE org_id=?', org), stmt(db, 'SELECT * FROM agreements WHERE org_id=?', org),
    stmt(db, 'SELECT * FROM budget_periods WHERE org_id=?', org),
  ]);
  return { organizationId: org, decisionId: `dec_${crypto.randomUUID()}`, checkedAt: new Date().toISOString(),
    budgetPeriodKey: periodKey('America/Caracas'), policy: policyDto(rows[0].results[0]), vendors: rows[1].results.map(vendorDto),
    agreements: rows[2].results.map(agreementDto), budget: budgetDto(rows[3].results[0]), priorInvoices };
}
async function record(db, invoice, { action = 'BLOCK', at = instant, needsHumanApproval = false, approval = false } = {}) {
  const evaluation = evaluateInvoice({ id: invoice.id, documentSha256: invoice.file_sha256, primaryReadId: invoice.read.primaryReadId,
    extraction: invoice.ex, corroboration: invoice.read.corroboration, agreementReference: null }, await context(db));
  evaluation.candidate = { ...evaluation.candidate, action, checkedAt: at, needsHumanApproval,
    reasons: [needsHumanApproval ? 'HUMAN_APPROVAL_REQUIRED' : action === 'APPROVE' ? 'POLICY_ALLOWED' : 'UNKNOWN_VENDOR'] };
  const statements = decisionStatements(db, org, evaluation, invoice.read);
  await db.batch(approval ? statements : statements.slice(0, 2));
  return evaluation.candidate;
}
const asPrior = row => ({ id: row.id, documentSha256: row.file_sha256, vendorId: row.vendor_id,
  agreementId: row.agreement_id, extraction: row.extracted_json ? JSON.parse(row.extracted_json).extraction : empty,
  reservationActive: !!row.reserved });

test('SQL pagination filters by latest inserted decision at tied timestamps and retains total beyond last page', async t => {
  const db = await setup(t);
  const expected = [];
  for (let n = 0; n < 26; n++) {
    const invoice = await addInvoice(db, `inv_${String(n).padStart(3, '0')}`);
    if (n % 2) { await record(db, invoice, { action: 'ESCALATE' }); expected.unshift(invoice.id); }
    else await record(db, invoice);
  }
  const chosen = await addInvoice(db, 'inv_z_latest');
  await record(db, chosen, { action: 'ESCALATE', at: '2026-10-16T12:00:00.000Z' });
  await record(db, chosen, { action: 'BLOCK' });
  await record(db, chosen, { action: 'ESCALATE' });
  // A late insertion with an older timestamp must not become the latest decision.
  await record(db, chosen, { action: 'BLOCK', at: '2026-10-16T12:00:00.000Z' });
  expected.unshift(chosen.id);
  const first = await invoicePage(db, org, q({ action: 'ESCALATE', pageSize: 5 }));
  assert.deepEqual(first.data.map(i => i.id), expected.slice(0, 5));
  assert.deepEqual(first.pagination, { page: 1, pageSize: 5, total: expected.length });
  assert.deepEqual(first.data[0], await getInvoice(db, org, chosen.id, false));
  const second = await invoicePage(db, org, q({ action: 'ESCALATE', pageSize: 5, page: 2 }));
  assert.deepEqual(second.data.map(i => i.id), expected.slice(5, 10));
  assert.deepEqual((await invoicePage(db, org, q({ action: 'ESCALATE', page: 100 }))).pagination.total, expected.length);
  assert.equal((await invoicePage(db, org, q({ action: 'ESCALATE', page: 100 }))).data.length, 0);
  await stmt(db, "INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Other','USD','UTC')").run();
  await addInvoice(db, 'foreign_invoice', {}, { org: 'other' });
  assert.equal((await invoicePage(db, org, q())).pagination.total, 27);
  assert.equal((await invoicePage(db, 'other', q())).data[0].id, 'foreign_invoice');
});

test('approval pages retain requested historical approval while invoice includes newest approval and current policy eligibility', async t => {
  const db = await setup(t);
  const invoice = await addInvoice(db, 'inv_approval');
  await record(db, invoice, { action: 'ESCALATE', needsHumanApproval: true, approval: true });
  await stmt(db, "UPDATE approval_requests SET state='INVALIDATED' WHERE invoice_id=?", invoice.id).run();
  await record(db, invoice, { action: 'ESCALATE', needsHumanApproval: true, approval: true });
  const invalidated = await approvalPage(db, org, q({ state: 'INVALIDATED', pageSize: 1 }));
  assert.equal(invalidated.pagination.total, 1);
  assert.equal(invalidated.data[0].approval.state, 'INVALIDATED');
  assert.equal(invalidated.data[0].invoice.approvalRequest.state, 'PENDING');
  assert.equal((await invoicePage(db, org, q({ needsHumanApproval: true }))).pagination.total, 1);
  const pending = await approvalPage(db, org, q({ state: 'PENDING', pageSize: 1 }));
  assert.deepEqual(pending.data[0].invoice, await getInvoice(db, org, invoice.id, false));
  assert.equal(pending.data[0].approval.canApprove, true);
  await stmt(db, "UPDATE policy_versions SET status='SUPERSEDED' WHERE id='pol_demo_v1'").run();
  assert.equal((await approvalPage(db, org, q({ state: 'PENDING' }))).data[0].approval.canApprove, false);
  assert.equal((await invoicePage(db, org, q({ needsHumanApproval: true }))).pagination.total, 0);
  assert.equal((await invoicePage(db, org, q({ needsHumanApproval: false }))).pagination.total, 1);
});

test('dashboard aggregates current states without multiplying history, bounds upcoming and recent decisions, and handles empty tenants', async t => {
  const db = await setup(t);
  const invoice = await addInvoice(db, 'history');
  for (let n = 0; n < 12; n++) await record(db, invoice, { action: n === 11 ? 'ESCALATE' : 'BLOCK' });
  for (let n = 0; n < 8; n++) await addInvoice(db, `upcoming_${n}`, { dueDate: `2026-10-${20 + n}` }, { status: 'RECEIVED' });
  await addInvoice(db, 'failed', {}, { status: 'FAILED' });
  const data = await dashboardInvoiceData(db, org, '2026-10-17');
  assert.deepEqual(data.counts, { total: 10, approved: 0, blocked: 0, escalated: 1, needsHumanApproval: 0, processing: 8, failed: 1 });
  assert.equal(data.recentDecisions.length, 10);
  assert.equal(data.recentDecisions[0].action, 'ESCALATE');
  assert.deepEqual(data.upcoming.map(i => i.id), ['upcoming_0', 'upcoming_1', 'upcoming_2', 'upcoming_3', 'upcoming_4']);
  const full = await invoiceRows(db, org);
  assert.equal(full.find(i => i.id === 'history').latestDecision.id, data.recentDecisions[0].id);
  const nothing = await dashboardInvoiceData(db, 'absent', '2026-10-17');
  assert.deepEqual(nothing.counts, { total: 0, approved: 0, blocked: 0, escalated: 0, needsHumanApproval: 0, processing: 0, failed: 0 });
  assert.deepEqual(nothing.upcoming, []);
  assert.deepEqual(nothing.recentDecisions, []);
});

test('selective snapshot preserves hash, Unicode invoice numbers, similar facts and obligations without a candidate cap', async t => {
  const db = await setup(t);
  for (let n = 0; n < 65; n++) await addInvoice(db, `unrelated_${n}`, { amountMinor: 1000 + n, issuedAt: '2025-01-01', servicePeriod: '2025-01' });
  await stmt(db, "INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Other','USD','UTC')").run();
  const reserved = await addInvoice(db, 'reserved_monthly', { invoiceNumber: 'ALREADY-RESERVED' },
    { vendor: 'vendor_demo_cloud', agreement: 'agr_demo_cloud' });
  await record(db, reserved, { action: 'APPROVE' });
  await stmt(db, `INSERT INTO agreements(id,org_id,vendor_id,currency,amount_minor,tolerance_minor,frequency,concept,active)
    VALUES ('agr_one_time',?,'vendor_demo_cloud','USD',20000,0,'ONE_TIME','Hosting mensual ficticio',1)`, org).run();
  const once = await addInvoice(db, 'reserved_once', { servicePeriod: '2025-01' }, { vendor: 'vendor_demo_cloud', agreement: 'agr_one_time' });
  await record(db, once, { action: 'APPROVE' });
  const unicode = await addInvoice(db, 'unicode_number', { invoiceNumber: 'ＡＢＣ / ００１', amountMinor: 12222, issuedAt: '2025-02-01' }, { vendor: 'vendor_demo_cloud' });
  const similar = await addInvoice(db, 'similar', { invoiceNumber: 'SIM', description: '  Cafe\u0301\t  mensual ', amountMinor: 18888 }, { vendor: 'vendor_demo_cloud' });
  const hashOnly = await addInvoice(db, 'hash_only', { ...empty });
  await addInvoice(db, 'foreign_collision', { invoiceNumber: 'ABC001', amountMinor: 18888 }, { org: 'other', hash: hashOnly.file_sha256 });
  const cases = [
    { id: 'target_hash', ex: empty, hash: hashOnly.file_sha256 },
    { id: 'target_number', ex: { invoiceNumber: 'abc-001', amountMinor: 22222, issuedAt: '2026-09-01' } },
    { id: 'target_similar', ex: { invoiceNumber: 'NEW', description: 'Café mensual', amountMinor: 18888 } },
    { id: 'target_unknown_similar', ex: { vendorName: 'Unknown', description: 'Café mensual', amountMinor: 18888 } },
    { id: 'target_monthly_ref', ex: { amountMinor: 19999, description: 'Different concept', invoiceNumber: 'NEW-MONTH' }, reference: 'agr_demo_cloud' },
    { id: 'target_once_ref', ex: { servicePeriod: '2026-08', amountMinor: 19998, description: 'Other concept', invoiceNumber: 'NEW-ONCE' }, reference: 'agr_one_time' },
  ];
  for (const c of cases) {
    const invoice = await addInvoice(db, c.id, c.ex, { hash: c.hash });
    const selected = (await snapshotInvoicesStatement(db, org, invoice.id).all()).results;
    const full = (await stmt(db, `SELECT i.*, EXISTS(SELECT 1 FROM budget_reservations r WHERE r.org_id=i.org_id AND r.invoice_id=i.id) AS reserved
      FROM invoices i WHERE i.org_id=?`, org).all()).results;
    assert.ok(selected.length < full.length / 2, `${c.id}: only relevant candidates should cross the Worker boundary`);
    assert.equal(selected.some(i => i.id === 'foreign_collision'), false);
    assert.ok(selected.some(i => i.id === invoice.id));
    const input = { id: invoice.id, documentSha256: invoice.file_sha256, primaryReadId: invoice.read.primaryReadId,
      extraction: invoice.ex, corroboration: invoice.read.corroboration, agreementReference: c.reference ?? null };
    const base = await context(db);
    const evaluate = rows => evaluateInvoice(input, { ...base, priorInvoices: rows.map(asPrior) }).candidate;
    const expected = evaluate(full), actual = evaluate(selected);
    assert.equal(actual.action, expected.action, c.id);
    assert.deepEqual(actual.reasons, expected.reasons, c.id);
    if (c.reference) assert.ok(actual.reasons.includes('DUPLICATE_INVOICE'), c.id);
    if (c.id.includes('similar')) assert.ok(actual.reasons.includes('POSSIBLE_DUPLICATE'), c.id);
    if (c.id === 'target_number') assert.ok(selected.some(i => i.id === unicode.id));
    if (c.id.includes('similar')) assert.ok(selected.some(i => i.id === similar.id));
  }
  for (let n = 0; n < 31; n++) await addInvoice(db, `same_number_${n}`, { invoiceNumber: 'NO-CAP', issuedAt: '2024-01-01' });
  const target = await addInvoice(db, 'target_no_cap', { invoiceNumber: 'NO-CAP', issuedAt: '2026-09-01' });
  const matches = (await snapshotInvoicesStatement(db, org, target.id).all()).results;
  assert.equal(matches.filter(i => i.normalized_invoice_no === 'NOCAP').length, 32);
  assert.deepEqual((await snapshotInvoicesStatement(db, 'other', target.id).all()).results, []);
});

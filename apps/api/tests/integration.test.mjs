import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { InvoiceDetailSchema, SessionSchema } from '@oli/contracts';
import worker from '../worker/index.js';
import { processInvoice, snapshot } from '../worker/processing.js';
import { corroboratePdfText, READER_VERSION } from '../worker/document.js';
import { audit, clearGuard, guard, id, now, originCheck, periodKey, stmt } from '../worker/http.js';
import { evaluationReport, evaluationSummary } from '../worker/evaluation.js';

const origin = 'https://oli.invalid';

test('manual confirmation resolves reading uncertainty, preserves the original and reserves once', async t => {
  const { api, env, DB, upload, read, ledger } = await setup(t);
  const invoice = await upload();
  const result = await processInvoice(env, 'org_demo', invoice.id,
    read(extraction({ extractionWarnings: ['INDEPENDENT_READ_UNAVAILABLE:vendorName'] }), { corroboration: null }));
  assert.equal(result.data.latestDecision.action, 'ESCALATE');
  assert.equal(result.data.approvalRequest, null);
  const before = await DB.prepare('SELECT extracted_json FROM invoices WHERE id=?').bind(invoice.id).first('extracted_json');
  const data = { confirm: true, comment: 'Revisé el documento original y confirmo sus datos.',
    expectedDecisionId: result.data.latestDecision.id, expectedPolicyVersionId: result.data.latestDecision.policyVersionId };
  const key = crypto.randomUUID();
  const approved = await api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', data, key });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  assert.equal(approved.data.latestDecision.action, 'APPROVE');
  assert.deepEqual(approved.data.latestDecision.actor, { kind: 'HUMAN', userId: 'user_demo_owner' });
  assert.equal(approved.data.latestDecision.trace.find(s => s.rule === 'EXTRACTION').evidence.status, 'HUMAN_CONFIRMED');
  assert.equal(approved.data.decisions.length, 2);
  assert.equal(await DB.prepare('SELECT extracted_json FROM invoices WHERE id=?').bind(invoice.id).first('extracted_json'), before);
  assert.equal(await DB.prepare('SELECT count(*) n FROM invoice_manual_reviews').first('n'), 1);
  const after = await ledger();
  assert.equal(after.reserved, 20000); assert.equal(after.reservations, 1);
  const replay = await api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', data, key });
  assert.equal(replay.status, 200); assert.deepEqual(replay.data, approved.data);
  assert.deepEqual(await ledger(), after);
  const stale = await api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', data, key: crypto.randomUUID() });
  assert.equal(stale.status, 409); assert.deepEqual(await ledger(), after);
  await assert.rejects(DB.prepare("UPDATE invoice_manual_reviews SET comment='changed'").run(), /REVIEW_HISTORY_IMMUTABLE/);
  await assert.rejects(DB.prepare('DELETE FROM invoice_manual_reviews').run(), /REVIEW_HISTORY_IMMUTABLE/);
});

test('manual confirmation keeps hard limits and unknown vendor protections', async t => {
  for (const [name, changes, expectedReason] of [
    ['hard limit', { amountMinor: 200000 }, 'AMOUNT_ABOVE_HARD_LIMIT'],
    ['unknown vendor', { vendorName: 'Proveedor no registrado' }, 'UNKNOWN_VENDOR'],
  ]) await t.test(name, async t => {
    const { api, env, upload, read, ledger } = await setup(t);
    const invoice = await upload();
    const result = await processInvoice(env, 'org_demo', invoice.id, read(extraction({ ...changes, extractionWarnings: ['Needs checking'] }), { corroboration: null }));
    const response = await api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', key: crypto.randomUUID(), data: {
      confirm: true, comment: 'Datos comprobados por mí', expectedDecisionId: result.data.latestDecision.id,
      expectedPolicyVersionId: result.data.latestDecision.policyVersionId,
    } });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.latestDecision.action, 'BLOCK');
    assert.ok(response.data.latestDecision.reasons.includes(expectedReason));
    assert.equal((await ledger()).reservations, 0);
  });
});

test('manual approval requires explicit confirmation, current context and complete invoice data', async t => {
  const { api, env, upload, read, ledger } = await setup(t);
  const invoice = await upload();
  const result = await processInvoice(env, 'org_demo', invoice.id, read(extraction({ vendorName: null }), { corroboration: null }));
  const input = { confirm: true, comment: 'Confirmado', expectedDecisionId: result.data.latestDecision.id, expectedPolicyVersionId: result.data.latestDecision.policyVersionId };
  const before = await ledger();
  for (const [data, status] of [[{ ...input, confirm: false }, 400], [{ ...input, vendorName: 'Injected' }, 400],
    [{ ...input, expectedPolicyVersionId: 'outdated' }, 409], [{ ...input, expectedDecisionId: 'outdated' }, 409], [input, 409]]) {
    const response = await api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', key: crypto.randomUUID(), data });
    assert.equal(response.status, status, JSON.stringify(response));
    assert.deepEqual(await ledger(), before);
  }
});

test('concurrent manual confirmations cannot double reserve or override duplicates and budget', async t => {
  const { api, env, DB, upload, read, ledger } = await setup(t);
  const confirm = (invoice, decision) => api(`/invoices/${invoice.id}/confirm-review`, { method: 'POST', key: crypto.randomUUID(), data: {
    confirm: true, comment: 'Confirmé el documento', expectedDecisionId: decision.id, expectedPolicyVersionId: decision.policyVersionId,
  } });
  const first = await upload();
  const firstRead = await processInvoice(env, 'org_demo', first.id, read(extraction(), { corroboration: null }));
  const race = await Promise.all([confirm(first, firstRead.data.latestDecision), confirm(first, firstRead.data.latestDecision)]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  assert.equal((await ledger()).reservations, 1);
  const duplicate = await upload({ file: { name: 'duplicate.pdf' } });
  const duplicateRead = await processInvoice(env, 'org_demo', duplicate.id, read(extraction(), { corroboration: null }));
  const blockedDuplicate = await confirm(duplicate, duplicateRead.data.latestDecision);
  assert.equal(blockedDuplicate.status, 200);
  assert.equal(blockedDuplicate.data.latestDecision.action, 'BLOCK');
  assert.ok(blockedDuplicate.data.latestDecision.reasons.includes('DUPLICATE_INVOICE'));
  await DB.prepare('UPDATE budget_periods SET limit_minor=reserved_minor+1000').run();
  const noBudget = await upload({ file: { name: 'budget.pdf', bytes: new TextEncoder().encode('%PDF-1.4\nAnother synthetic invoice') } });
  const budgetRead = await processInvoice(env, 'org_demo', noBudget.id,
    read(extraction({ invoiceNumber: 'DEMO-BUDGET', servicePeriod: '2026-11' }), { corroboration: null }));
  const blockedBudget = await confirm(noBudget, budgetRead.data.latestDecision);
  assert.equal(blockedBudget.status, 200, JSON.stringify(blockedBudget));
  assert.equal(blockedBudget.data.latestDecision.action, 'BLOCK');
  assert.ok(blockedBudget.data.latestDecision.reasons.includes('BUDGET_EXCEEDED'));
  assert.equal((await ledger()).reservations, 1);
});
const pdf = new TextEncoder().encode('%PDF-1.4\nsynthetic integration fixture, provider is mocked');
const extraction = (overrides = {}) => ({ vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'DEMO-001',
  amountMinor: 20000, currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
  description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [], ...overrides });
const text = (ex) => `EMISOR / SUPPLIER
${ex.vendorName}
Número / Number
${ex.invoiceNumber}
Emisión / Issued
${ex.issuedAt}
Vencimiento / Due
${ex.dueDate}
Periodo de servicio
${ex.servicePeriod}
Moneda / Currency
${ex.currency}
CONCEPTO / DESCRIPTION
${ex.description}
TOTAL A COBRAR
${ex.currency} ${(ex.amountMinor / 100).toFixed(2)}`;

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'integration' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const path of files) {
    const sql = readFileSync(path, 'utf8').split('\n-- statement-breakpoint\n').map(s => s.trim()).filter(Boolean);
    await DB.batch(sql.map(s => DB.prepare(s)));
  }
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner',
    DEMO_PASSWORD: 'synthetic-test-password', OPENROUTER_API_KEY: 'test-only' };
  let cookie = ''; let csrf = '';
  const api = async (path, { method = 'GET', data, file, key, headers = {} } = {}) => {
    let payload = data === undefined ? undefined : JSON.stringify(data);
    const h = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...headers };
    if (data !== undefined) h['Content-Type'] = 'application/json';
    if (file) { payload = new FormData(); payload.append('file', new Blob([file.bytes ?? pdf], { type: file.type ?? 'application/pdf' }), file.name ?? 'demo.pdf'); }
    if (key) h['Idempotency-Key'] = key;
    const response = await worker.fetch(new Request(`${origin}/api/v1${path}`, { method, body: payload, headers: h }), env);
    const raw = response.status === 204 ? null : await response.json();
    return { status: response.status, ...raw, headers: response.headers };
  };
  const logged = await api('/session', { method: 'POST', data: { email: 'owner@oli-demo.invalid', password: env.DEMO_PASSWORD } });
  assert.equal(logged.status, 200); SessionSchema.parse(logged.data);
  cookie = logged.headers.get('Set-Cookie').split(';')[0]; csrf = logged.data.csrfToken;
  const upload = async (options = {}) => {
    const result = await api('/invoices', { method: 'POST', file: {}, key: crypto.randomUUID(), ...options });
    assert.equal(result.status, 201, JSON.stringify(result)); return result.data;
  };
  const read = (ex = extraction(), changes = {}) => async (_env, _file, _bytes, documentSha256) => ({
    extraction: ex, documentType: 'INVOICE', primaryReadId: crypto.randomUUID(), documentSha256,
    corroboration: corroboratePdfText(text(ex), documentSha256), provenance: { model: 'synthetic-test-only' }, ...changes });
  const ledger = async () => ({
    reserved: await DB.prepare('SELECT coalesce(sum(reserved_minor), 0) AS n FROM budget_periods').first('n'),
    reservations: await DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'),
    decisions: await DB.prepare('SELECT count(*) AS n FROM decisions').first('n'),
  });
  return { env, DB, api, upload, read, ledger, cookie: () => cookie };
}

test('evaluación publicada: métricas históricas consistentes, procedencia y sesión obligatoria', async t => {
  const { api, env } = await setup(t);
  const summary = evaluationSummary(), report = evaluationReport();
  const source = readFileSync(new URL('../../../' + report.reportPath, import.meta.url));
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(source).digest('hex'), report.reportSha256);
  const run = JSON.parse(source);
  assert.equal(summary.totalCases, 20);
  assert.equal(summary.correctDecisions, run.results.filter(row => row.correct).length);
  assert.equal(summary.unsafeApprovals, run.results.filter(row => row.unsafeApproval).length);
  assert.equal(summary.correctAutonomy, summary.correctAutonomousCases / 20);
  assert.equal(summary.explanationCoverage, summary.explainedDecisions / 20);
  assert.equal(report.workerVersion, run.backendAtStart.version);
  assert.deepEqual((await api('/evaluation/summary')).data, summary);
  assert.deepEqual((await api('/evaluation/report')).data.summary, summary);
  assert.equal(report.targetedP0IncludedInDenominator, false);
  for (const path of ['/evaluation/summary', '/evaluation/report']) {
    const denied = await worker.fetch(new Request(origin + '/api/v1' + path), env);
    assert.equal(denied.status, 401);
  }
});

test('sesión protegida, CSRF, origen y logout; no acepta autoridad del navegador', async t => {
  const { api, env } = await setup(t);
  const me = await api('/me'); assert.equal(me.status, 200); SessionSchema.parse(me.data);
  assert.equal((await api('/vendors', { method: 'POST', data: { name: 'x', allowed: true, externalRef: null }, headers: { 'X-CSRF-Token': 'bad' } })).status, 403);
  assert.equal((await api('/session', { method: 'POST', data: { email: 'owner@oli-demo.invalid', password: env.DEMO_PASSWORD }, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await api('/vendors', { method: 'POST', data: { name: 'x', allowed: true, externalRef: null, orgId: 'evil' } })).status, 400);
  assert.equal((await api('/session', { method: 'DELETE' })).status, 204);
  assert.equal((await api('/me')).status, 401);
});

test('el usuario demo solo entra por alias configurado y contraseña correcta', async t => {
  const { api, env } = await setup(t);
  const credentials = { email: 'admin', password: env.DEMO_PASSWORD };
  const signIn = (data) => api('/session', { method: 'POST', data });
  assert.equal((await signIn(credentials)).status, 401, 'no existe un alias implícito');
  env.DEMO_USERNAME = 'admin';
  assert.equal((await signIn({ ...credentials, password: 'wrong' })).status, 401);
  assert.equal((await signIn({ ...credentials, email: 'someone-else' })).status, 401);
  const logged = await signIn(credentials);
  assert.equal(logged.status, 200);
  SessionSchema.parse(logged.data);
  assert.equal(logged.data.user.id, env.DEMO_USER_ID);
  assert.equal(logged.data.user.email, 'owner@oli-demo.invalid');
  assert.equal(logged.data.role, 'OWNER');
  env.DEMO_ORG_ID = 'nonexistent-org';
  assert.equal((await signIn(credentials)).status, 401, 'el alias no omite la pertenencia a la empresa');
});

test('demo accounts keep credentials, onboarding and invoice access isolated by organization', async t => {
  const { api, env, DB, upload } = await setup(t);
  const existing = await upload();
  for (const suffix of ['one', 'two']) {
    await DB.prepare('INSERT INTO organizations(id,name,default_currency,timezone) VALUES (?,?,?,?)')
      .bind(`org_${suffix}`, `Fictional ${suffix}`, 'USD', 'UTC').run();
    await DB.prepare('INSERT INTO users(id,name,email) VALUES (?,?,?)')
      .bind(`user_${suffix}`, `Demo ${suffix}`, `${suffix}@oli-demo.invalid`).run();
    await DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,'OWNER')")
      .bind(`org_${suffix}`, `user_${suffix}`).run();
  }
  const accounts = { demo_one: { userId: 'user_one', orgId: 'org_one', password: 'test-one' },
    demo_two: { userId: 'user_two', orgId: 'org_two', password: 'test-two' } };
  env.DEMO_ACCOUNTS = JSON.stringify(accounts);
  const signIn = (email, password) => api('/session', { method: 'POST', data: { email, password } });
  for (const [username, account] of Object.entries(accounts)) {
    const signed = await signIn(username.toUpperCase(), account.password);
    assert.equal(signed.status, 200); assert.equal(signed.data.organization.id, account.orgId);
    assert.equal(signed.data.user.id, account.userId);
    const headers = { Cookie: signed.headers.get('Set-Cookie').split(';')[0] };
    assert.equal((await api('/me', { headers })).data.organization.id, account.orgId);
    assert.equal((await api('/mandate', { headers })).data.active, null);
    assert.equal((await api('/mandate', { headers })).data.draft, null);
    assert.deepEqual((await api('/invoices', { headers })).data, []);
    assert.equal((await api(`/invoices/${existing.id}`, { headers })).status, 404);
    assert.equal((await api(`/invoices/${existing.id}/file`, { headers })).status, 404);
  }
  assert.equal((await signIn('demo_one', 'test-two')).status, 401);
  assert.equal((await signIn('demo_two', env.DEMO_PASSWORD)).status, 401);
  assert.equal((await signIn('owner@oli-demo.invalid', env.DEMO_PASSWORD)).status, 200);
  accounts.demo_one.orgId = 'org_two'; env.DEMO_ACCOUNTS = JSON.stringify(accounts);
  assert.equal((await signIn('demo_one', 'test-one')).status, 401, 'the secret cannot bypass D1 membership');
});

test('demo account configuration fails closed and does not require the legacy account', async t => {
  const { api, env } = await setup(t);
  const data = { email: 'standalone', password: 'test-only' };
  const account = { userId: env.DEMO_USER_ID, orgId: env.DEMO_ORG_ID, password: data.password };
  delete env.DEMO_PASSWORD; delete env.DEMO_USER_ID; delete env.DEMO_ORG_ID;
  env.DEMO_ACCOUNTS = JSON.stringify({ standalone: account });
  assert.equal((await api('/session', { method: 'POST', data })).status, 200);
  for (const value of ['{broken', 'null', '[]', '{"standalone":{}}', '{"standalone":{"password":"test-only","userId":"","orgId":"x"}}']) {
    env.DEMO_ACCOUNTS = value;
    assert.equal((await api('/session', { method: 'POST', data })).status, 503);
  }
});

test('onboarding guarda borrador y activa versión/budget con idempotencia y sin mutar v1', async t => {
  const { api, DB } = await setup(t);
  const before = (await api('/mandate')).data.active;
  const draft = await api('/mandate/draft', { method: 'PUT', data: { expectedRevision: null, basedOnPolicyVersionId: before.id,
    rules: { ...before.rules, automaticLimitMinor: 25000, reviewAboveMinor: 25000, monthlyBudgetMinor: 150000 } } });
  assert.equal(draft.status, 200);
  assert.equal((await api('/mandate/draft', { method: 'PUT', data: { expectedRevision: null, basedOnPolicyVersionId: before.id, rules: before.rules } })).status, 409);
  const activation = { method: 'POST', key: crypto.randomUUID(), data: { draftId: draft.data.id, expectedRevision: draft.data.revision,
    expectedActivePolicyVersionId: before.id, confirmed: true } };
  const activated = await api('/mandate/activate', activation); assert.equal(activated.status, 200, JSON.stringify(activated));
  assert.equal(activated.data.version, 2); assert.equal(activated.data.rules.automaticLimitMinor, 25000);
  assert.deepEqual((await api('/mandate/activate', activation)).data, activated.data);
  assert.equal(await DB.prepare("SELECT status FROM policy_versions WHERE id = 'pol_demo_v1'").first('status'), 'SUPERSEDED');
  assert.equal((await api('/budgets')).data[0].limitMinor, 150000);
});

test('subida privada idempotente; nueva clave crea documento auditable distinto y otras empresas dan 404', async t => {
  const { api, upload, DB, env, cookie } = await setup(t);
  const key = crypto.randomUUID(); const first = await upload({ key }); const replay = await upload({ key });
  assert.equal(first.id, replay.id); const next = await upload(); assert.notEqual(next.id, first.id);
  assert.equal((await api('/invoices', { method: 'POST', key, file: { name: 'different.pdf' } })).status, 409);
  assert.equal((await api(`/invoices/${first.id}`)).data.file.url.includes('uploads/'), false);
  await DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Other demo','USD','UTC')").run();
  await assert.rejects(stmt(DB, 'UPDATE invoices SET org_id = ? WHERE id = ?', 'other', next.id).run(), /FOREIGN KEY/);
  await stmt(DB, `INSERT INTO invoices(id,org_id,file_key,file_name,file_mime_type,file_size_bytes,file_sha256)
    SELECT 'foreign-invoice','other',file_key,file_name,file_mime_type,file_size_bytes,file_sha256 FROM invoices WHERE id=?`, next.id).run();
  assert.equal((await api('/invoices/foreign-invoice')).status, 404);
  const response = await worker.fetch(new Request(`${origin}${first.file.url}`, { headers: { Cookie: (await DB.prepare('SELECT token_hash FROM sessions').first()).token_hash } }), env);
  assert.equal(response.status, 401);
  const preview = await worker.fetch(new Request(`${origin}${first.file.url}`, { headers: { Cookie: cookie() } }), env);
  assert.equal(preview.status, 200); assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), pdf);
  assert.equal(preview.headers.get('Content-Type'), 'application/pdf');
  assert.equal(preview.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 3);
});

test('extracción→motor→D1 confirma APPROVE y reserva una sola vez; historial y dashboard coherentes', async t => {
  const { env, api, upload, read, ledger } = await setup(t);
  const received = await upload(); const result = await processInvoice(env, 'org_demo', received.id, read());
  assert.equal(result.status, 200); InvoiceDetailSchema.parse(result.data);
  assert.equal(result.data.latestDecision.action, 'APPROVE', JSON.stringify(result.data.latestDecision));
  assert.equal(result.data.decisions.length, 1);
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 1 });
  await processInvoice(env, 'org_demo', received.id, async () => assert.fail('no debe releer'));
  const detail = await api(`/invoices/${received.id}`); assert.equal(detail.data.latestDecision.action, 'APPROVE');
  const dashboard = (await api('/dashboard')).data; assert.equal(dashboard.counts.approved, 1); assert.equal(dashboard.budgets[0].reservedMinor, 20000);
});

test('duplicado del mismo archivo queda BLOCK sin segunda reserva', async t => {
  const { env, upload, read, ledger } = await setup(t);
  const first = await upload(); await processInvoice(env, 'org_demo', first.id, read());
  const second = await upload(); const result = await processInvoice(env, 'org_demo', second.id, read());
  assert.equal(result.data.latestDecision.action, 'BLOCK'); assert.ok(result.data.latestDecision.reasons.includes('DUPLICATE_INVOICE'));
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 2 });
});

test('sin corroboración o con discrepancia no autoriza ni crea botón humano', async t => {
  const { env, upload, read, ledger } = await setup(t);
  const invoice = await upload(); const result = await processInvoice(env, 'org_demo', invoice.id, read(extraction(), { corroboration: null }));
  assert.equal(result.data.latestDecision.action, 'ESCALATE'); assert.equal(result.data.approvalRequest, null);
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 1 });
});

test('antecedente con proveedor sin resolver impide aprobar otro archivo del mismo número', async t => {
  const { env, DB, upload, read, ledger } = await setup(t);
  const first = await upload();
  const uncertain = (await processInvoice(env, 'org_demo', first.id, read(extraction({ amountMinor: 19000 }), { corroboration: null }))).data;
  assert.equal(uncertain.latestDecision.action, 'ESCALATE');
  assert.equal(uncertain.vendorId, null);
  const second = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4\ncorrected representation of prior invoice') } });
  const result = (await processInvoice(env, 'org_demo', second.id, read())).data;
  assert.equal(result.latestDecision.action, 'ESCALATE');
  assert.ok(result.latestDecision.reasons.includes('POSSIBLE_DUPLICATE'));
  assert.equal(result.approvalRequest, null);
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
  assert.equal((await DB.prepare('SELECT vendor_id FROM invoices WHERE id=?').bind(first.id).first()).vendor_id, null);
  await processInvoice(env, 'org_demo', second.id, async () => assert.fail('El replay no relee ni elimina el antecedente'));
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

test('revisión humana agrega decisión y reserva; replay y dos revisores no duplican', async t => {
  const { env, api, upload, read, ledger } = await setup(t);
  const invoice = await upload(); const ex = extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' });
  const processed = (await processInvoice(env, 'org_demo', invoice.id, read(ex))).data;
  assert.equal(processed.latestDecision.action, 'ESCALATE'); assert.equal(processed.approvalRequest.canApprove, true);
  const options = { method: 'POST', key: crypto.randomUUID(), data: { action: 'APPROVE', comment: 'Verifiqué el acuerdo ficticio.',
    expectedDecisionId: processed.latestDecision.id, expectedPolicyVersionId: processed.latestDecision.policyVersionId } };
  const results = await Promise.all([api(`/approvals/${processed.approvalRequest.id}/decision`, options), api(`/approvals/${processed.approvalRequest.id}/decision`, options)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(results[0].data.invoice.latestDecision.actor.kind, 'HUMAN');
  assert.deepEqual(await ledger(), { reserved: 45000, reservations: 1, decisions: 2 });
  assert.deepEqual((await api(`/approvals/${processed.approvalRequest.id}/decision`, options)).data, results[0].data);
});

test('rechazo humano conserva escalación sin reservar presupuesto', async t => {
  const { env, api, upload, read, ledger } = await setup(t);
  const invoice = await upload(); const ex = extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' });
  const detail = (await processInvoice(env, 'org_demo', invoice.id, read(ex))).data;
  const result = await api(`/approvals/${detail.approvalRequest.id}/decision`, { method: 'POST', key: crypto.randomUUID(),
    data: { action: 'REJECT', comment: 'No autorizo esta excepción.', expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId } });
  assert.equal(result.status, 200); assert.equal(result.data.invoice.latestDecision.action, 'BLOCK');
  assert.equal(result.data.invoice.decisions.length, 2); assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

test('cambio del proveedor invalida solicitud humana y registra bloqueo vigente', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  const invoice = await upload(); const ex = extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' });
  const detail = (await processInvoice(env, 'org_demo', invoice.id, read(ex))).data;
  await DB.prepare("UPDATE vendors SET allowed = 0 WHERE id = 'vendor_demo_acme'").run();
  const result = await api(`/approvals/${detail.approvalRequest.id}/decision`, { method: 'POST', key: crypto.randomUUID(),
    data: { action: 'APPROVE', comment: 'Botón antiguo', expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId } });
  assert.equal(result.status, 409); assert.equal(result.error.code, 'APPROVAL_NOT_ALLOWED');
  const current = (await api(`/invoices/${invoice.id}`)).data;
  assert.equal(current.latestDecision.action, 'BLOCK'); assert.equal(current.approvalRequest.state, 'INVALIDATED');
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

test('dos process simultáneos solo ejecutan una lectura y una decisión', async t => {
  const { env, upload, read, ledger } = await setup(t); const invoice = await upload(); let calls = 0;
  const adapter = read();
  const held = async (...args) => { calls++; await new Promise(resolve => setTimeout(resolve, 50)); return adapter(...args); };
  const results = await Promise.all([processInvoice(env, 'org_demo', invoice.id, held), processInvoice(env, 'org_demo', invoice.id, held)]);
  assert.equal(calls, 1); assert.ok(results.some(r => r.status === 200));
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 1 });
});

test('dos obligaciones compiten por presupuesto: una aprueba, otra bloquea, sin saldo negativo', async t => {
  const { env, DB, upload, read, ledger } = await setup(t);
  await DB.prepare("UPDATE budget_periods SET limit_minor = 30000 WHERE id = 'budget_demo_current'").run();
  const a = await upload(); const b = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4\nsecond document') } });
  const results = await Promise.all([processInvoice(env, 'org_demo', a.id, read()),
    processInvoice(env, 'org_demo', b.id, read(extraction({ invoiceNumber: 'DEMO-002', servicePeriod: '2026-11' })))]);
  assert.deepEqual(results.map(r => r.data.latestDecision.action).sort(), ['APPROVE', 'BLOCK']);
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 2 });
});

test('caída técnica queda FAILED reintentable sin decisión; reintento reutiliza factura', async t => {
  t.mock.method(console, 'error', () => {});
  const { env, upload, read, ledger } = await setup(t); const invoice = await upload();
  const failed = await processInvoice(env, 'org_demo', invoice.id, async () => { throw new Error('provider down with secret'); });
  assert.equal(failed.data.status, 'FAILED'); assert.equal(failed.data.processingError.retryable, true);
  assert.equal(JSON.stringify(failed).includes('secret'), false); assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 0 });
  assert.equal((await processInvoice(env, 'org_demo', invoice.id, read())).data.latestDecision.action, 'APPROVE');
});

test('ruta pública process usa adapter PDF real con HTTP/AI simulados, sin etiquetas esperadas en prompt', async t => {
  const { env, api, upload, ledger } = await setup(t); const invoice = await upload(); let calls = 0;
  env.AI = { toMarkdown: async () => ({ format: 'markdown', data: text(extraction()) }) };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.plugins[0].pdf.engine, 'native');
    assert.ok(payload.messages[1].content.some(c => c.type === 'file'));
    assert.equal(options.body.includes('Demo Cloud Hosting'), false);
    return Response.json({ model: payload.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...extraction(), documentType: 'INVOICE' }) } }] });
  });
  const result = await api(`/invoices/${invoice.id}/process`, { method: 'POST' });
  assert.equal(result.status, 200); assert.equal(result.data.latestDecision.action, 'APPROVE'); assert.equal(calls, 1);
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 1 });
});

test('parser separado rechaza totales conflictivos, monedas ausentes y etiquetas repetidas', () => {
  const hash = 'a'.repeat(64); const source = text(extraction());
  assert.equal(corroboratePdfText(source, hash).fields.amountMinor, 20000);
  const joined = 'EMISOR / SUPPLIERDemo Cloud Hosting (ficticio)Cliente: Lumen AtlasNúmero / Number DEMO-001Emisión / Issued 2026-10-01Vencimiento / Due 2026-10-31Periodo de servicio 2026-10Acuerdo / Agreement demoMoneda / Currency USDCONCEPTO / DESCRIPTIONHosting mensual ficticioTOTAL A COBRAR USD 200.00Importe final; no se añaden impuestos.';
  assert.deepEqual(corroboratePdfText(joined, hash).fields, { vendorName: extraction().vendorName, amountMinor: 20000, currency: 'USD', dueDate: '2026-10-31' });
  for (const value of [source + '\nOtro TOTAL: USD 280.00', source.replace('Moneda / Currency\nUSD', 'Moneda / Currency\nNO INDICADA'), source + '\nTOTAL A COBRAR\nUSD 200.00']) {
    assert.equal(corroboratePdfText(value, hash).fields.amountMinor, null);
  }
  assert.equal(periodKey('America/Caracas', new Date('2026-11-01T02:00:00Z')), '2026-10');
  const proxyRequest = new Request('http://localhost:8787/api/v1/session', { headers: { Origin: 'http://localhost:5173' } });
  assert.doesNotThrow(() => originCheck(proxyRequest, { DEV_WEB_ORIGIN: 'http://localhost:5173' }));
  assert.throws(() => originCheck(proxyRequest), /CSRF_INVALID/);
  assert.throws(() => originCheck(new Request('https://oli-api.tiamat-agency.workers.dev/api/v1/session',
    { headers: { Origin: 'http://localhost:5173' } }), { DEV_WEB_ORIGIN: 'http://localhost:5173' }), /CSRF_INVALID/);
});

test('snapshot obsoleto revierte todo el batch aunque la política conserve su ID', async t => {
  const { env, DB, upload, ledger } = await setup(t); const invoice = await upload();
  const state = await snapshot(DB, 'org_demo', invoice.id);
  await DB.prepare("UPDATE vendors SET allowed = 0 WHERE id = 'vendor_demo_cloud'").run();
  const guardId = id('guard');
  await assert.rejects(DB.batch([guard(DB, 'org_demo', state.revision, guardId),
    DB.prepare("UPDATE invoices SET status = 'FAILED' WHERE id = ?").bind(invoice.id), clearGuard(DB, guardId)]), /CHECK constraint/);
  assert.equal(await DB.prepare('SELECT status FROM invoices WHERE id = ?').bind(invoice.id).first('status'), 'RECEIVED');
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 0 });
});

test('APPROVER consulta y carga pero no modifica mandato ni directorio; login limita intentos', async t => {
  const { env, api } = await setup(t);
  env.DEMO_USER_ID = 'user_demo_approver';
  const logged = await api('/session', { method: 'POST', data: { email: 'approver@oli-demo.invalid', password: env.DEMO_PASSWORD } });
  assert.equal(logged.status, 200); assert.equal(logged.data.role, 'APPROVER');
  const response = await worker.fetch(new Request(`${origin}/api/v1/vendors`, { method: 'POST',
    headers: { Origin: origin, Cookie: logged.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': logged.data.csrfToken,
      'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', allowed: true, externalRef: null }) }), env);
  assert.equal(response.status, 403);
  for (let i = 0; i < 8; i++) assert.equal((await api('/session', { method: 'POST', data: { email: 'approver@oli-demo.invalid', password: 'wrong' } })).status, 401);
  assert.equal((await api('/session', { method: 'POST', data: { email: 'approver@oli-demo.invalid', password: 'wrong' } })).status, 429);
});

test('abre presupuesto del periodo empresarial vigente desde el mandato sin reiniciar reservas', async t => {
  const { env, DB, upload, read, ledger } = await setup(t); const invoice = await upload();
  await DB.prepare('DELETE FROM budget_periods').run();
  const previous = new Date(periodKey('America/Caracas') + '-01T12:00:00Z');
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  await stmt(DB, 'INSERT INTO budget_periods(id,org_id,currency,period_key,limit_minor) VALUES (?,?,?,?,?)',
    'budget_previous', 'org_demo', 'USD', previous.toISOString().slice(0, 7), 200000).run();
  const result = await processInvoice(env, 'org_demo', invoice.id, read());
  assert.equal(result.data.latestDecision.action, 'APPROVE');
  assert.equal(await DB.prepare("SELECT count(*) AS n FROM budget_periods WHERE period_key = ?").bind(periodKey('America/Caracas')).first('n'), 1);
  assert.equal(await DB.prepare("SELECT count(*) AS n FROM audit_events WHERE type = 'BUDGET_PERIOD_OPENED'").first('n'), 1);
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 1 });
});

test('sin presupuesto inicial no lo inventa; otra moneda o un periodo futuro no autorizan apertura', async t => {
  for (const prior of [null, { currency: 'EUR', period: '2020-01' }, { currency: 'USD', period: '2099-01' }]) {
    const { env, DB, upload, read, ledger } = await setup(t);
    await DB.prepare('DELETE FROM budget_periods').run();
    if (prior) await stmt(DB, 'INSERT INTO budget_periods(id,org_id,currency,period_key,limit_minor) VALUES (?,?,?,?,?)',
      'unrelated_budget', 'org_demo', prior.currency, prior.period, 200000).run();
    const invoice = await upload();
    const result = await processInvoice(env, 'org_demo', invoice.id, read());
    assert.equal(result.data.latestDecision.action, 'BLOCK');
    assert.ok(result.data.latestDecision.reasons.includes('MISSING_BUDGET'));
    assert.equal(result.data.approvalRequest, null);
    assert.equal(await DB.prepare("SELECT count(*) AS n FROM audit_events WHERE type = 'BUDGET_PERIOD_OPENED'").first('n'), 0);
    assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 1 });
  }
});

test('proveedor y acuerdo creados por onboarding alimentan el motor sin IDs del seed', async t => {
  const { env, api, upload, read } = await setup(t);
  const vendor = await api('/vendors', { method: 'POST', data: { name: 'Nuevo proveedor ficticio', allowed: true, externalRef: null } });
  assert.equal(vendor.status, 201);
  const agreement = await api('/agreements', { method: 'POST', data: { vendorId: vendor.data.id, currency: 'USD', amountMinor: 12000,
    toleranceMinor: 0, frequency: 'ONE_TIME', concept: 'Servicio nuevo ficticio', active: true } });
  assert.equal(agreement.status, 201);
  const invoice = await upload();
  const result = await processInvoice(env, 'org_demo', invoice.id, read(extraction({ vendorName: vendor.data.name,
    amountMinor: 12000, description: agreement.data.concept })));
  assert.equal(result.data.latestDecision.action, 'APPROVE'); assert.equal(result.data.agreementId, agreement.data.id);
  const filtered = await api('/invoices?action=APPROVE&needsHumanApproval=false'); assert.equal(filtered.data.length, 1);
  assert.equal((await api(`/agreements?vendorId=${vendor.data.id}`)).data[0].id, agreement.data.id);
});

test('un checkpoint pendiente del lector anterior se relee y no autoriza con controles obsoletos', async t => {
  const { env, DB, api, upload, ledger } = await setup(t);
  const invoice = await upload();
  const hash = await stmt(DB, 'SELECT file_sha256 FROM invoices WHERE id = ?', invoice.id).first('file_sha256');
  const old = { extraction: extraction(), documentSha256: hash, primaryReadId: 'old-primary',
    corroboration: corroboratePdfText(text(extraction()), hash), provenance: { configVersion: 'labelled-v1' } };
  await stmt(DB, `UPDATE invoices SET status='FAILED', extracted_json=?, processing_error_json=? WHERE id=?`,
    JSON.stringify(old), JSON.stringify({ code: 'CONCURRENT_UPDATE', message: 'Intento anterior interrumpido.', retryable: true }), invoice.id).run();
  let calls = 0;
  env.AI = { toMarkdown: async () => ({ format: 'markdown', data: text(extraction()) }) };
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ model: 'test', choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'Cannot read' } }] });
  });
  const result = await api(`/invoices/${invoice.id}/process`, { method: 'POST' });
  assert.equal(calls, 1, 'la extracción v1 no puede saltar el lector actual');
  assert.equal(result.data.status, 'FAILED');
  assert.equal(result.data.latestDecision, null);
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 0 });
});

const reanalysisInput = detail => ({ expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId });

test('reanálisis impone cooldown por hash, conserva replay y no bloquea documentos distintos', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  await DB.prepare("UPDATE vendors SET allowed=0 WHERE id='vendor_demo_cloud'").run();
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id, read())).data;
  const path = `/invoices/${invoice.id}/reevaluate`;
  const options = { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(first) };
  const updated = await api(path, options); assert.equal(updated.status, 200, JSON.stringify(updated));
  const before = await ledger();
  const limited = await api(path, { ...options, key: crypto.randomUUID(), data: reanalysisInput(updated.data) });
  assert.equal(limited.status, 429); assert.equal(limited.error.code, 'REANALYSIS_COOLDOWN');
  assert.ok(Number(limited.headers.get('Retry-After')) > 0 && Number(limited.headers.get('Retry-After')) <= 60);
  assert.deepEqual((await api(path, options)).data, updated.data);
  assert.deepEqual(await ledger(), before);
  const copy = await upload({ file: { name: 'same-bytes-renamed.pdf' } });
  const copyDetail = (await processInvoice(env, 'org_demo', copy.id, read())).data;
  const copyLimit = await api(`/invoices/${copy.id}/reevaluate`, { ...options, key: crypto.randomUUID(), data: reanalysisInput(copyDetail) });
  assert.equal(copyLimit.status, 429); assert.equal(copyLimit.error.code, 'REANALYSIS_COOLDOWN');
  const other = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4 different document') } });
  const otherDetail = (await processInvoice(env, 'org_demo', other.id, read())).data;
  assert.equal((await api(`/invoices/${other.id}/reevaluate`, { ...options, key: crypto.randomUUID(), data: reanalysisInput(otherDetail) })).status, 200);
  assert.equal(await DB.prepare("SELECT count(*) n FROM audit_events WHERE type='INVOICE_REEVALUATED'").first('n'), 2);
  assert.equal(await DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
});

test('reanálisis admite el tercero y agota cuota persistente sin reiniciarla por copia o replay', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  await DB.prepare("UPDATE vendors SET allowed=0 WHERE id='vendor_demo_cloud'").run();
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id, read())).data;
  // Synthetic historical successful requests establish usage before this process/session.
  for (let n = 1; n <= 2; n++) await audit(DB, 'org_demo', 'user_demo_owner', 'INVOICE_REEVALUATED',
    invoice.id, { syntheticHistoricalContext: true }, `2000-01-0${n}T00:00:00.000Z`).run();
  const path = `/invoices/${invoice.id}/reevaluate`;
  const options = { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(first) };
  const third = await api(path, options); assert.equal(third.status, 200, JSON.stringify(third));
  const before = await ledger();
  const fourth = await api(path, { ...options, key: crypto.randomUUID(), data: reanalysisInput(third.data) });
  assert.equal(fourth.status, 409); assert.equal(fourth.error.code, 'REANALYSIS_LIMIT_REACHED');
  assert.equal(fourth.headers.get('Retry-After'), null);
  assert.deepEqual((await api(path, options)).data, third.data);
  assert.deepEqual(await ledger(), before);
  const copy = await upload();
  const copyDetail = (await processInvoice(env, 'org_demo', copy.id, read())).data;
  const copyLimit = await api(`/invoices/${copy.id}/reevaluate`, { ...options, key: crypto.randomUUID(), data: reanalysisInput(copyDetail) });
  assert.equal(copyLimit.status, 409); assert.equal(copyLimit.error.code, 'REANALYSIS_LIMIT_REACHED');
  assert.equal(await DB.prepare("SELECT count(*) n FROM audit_events WHERE type='INVOICE_REEVALUATED'").first('n'), 3);
  assert.equal(await DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
});

test('D1 aplica cooldown y cuota atómicos entre copias, aísla empresas y revierte efectos previos', async t => {
  const { DB, upload } = await setup(t);
  const first = await upload(), copy = await upload();
  const write = invoice => DB.batch([
    audit(DB, 'org_demo', null, 'PRECEDING_TRANSACTION_EFFECT', invoice.id, {}),
    audit(DB, 'org_demo', 'user_demo_owner', 'INVOICE_REEVALUATED', invoice.id, {}),
  ]);
  const results = await Promise.allSettled([write(first), write(copy)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(results.find(r => r.status === 'rejected').reason), /REANALYSIS_COOLDOWN/);
  assert.equal(await DB.prepare("SELECT count(*) n FROM audit_events WHERE type='PRECEDING_TRANSACTION_EFFECT'").first('n'), 1);
  await stmt(DB, "INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Other','USD','UTC')").run();
  const source = await stmt(DB, 'SELECT * FROM invoices WHERE id=?', first.id).first();
  await stmt(DB, `INSERT INTO invoices(id,org_id,file_key,file_name,file_mime_type,file_size_bytes,file_sha256)
    VALUES ('other-copy','other','other-key','other.pdf','application/pdf',?,?)`, source.file_size_bytes, source.file_sha256).run();
  await audit(DB, 'other', null, 'INVOICE_REEVALUATED', 'other-copy', {}).run();

  const next = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4 fresh quota race') } });
  const nextCopy = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4 fresh quota race') } });
  for (let n = 1; n <= 2; n++) await audit(DB, 'org_demo', null, 'INVOICE_REEVALUATED',
    next.id, { syntheticHistoricalContext: true }, `2000-01-0${n}T00:00:00.000Z`).run();
  const exhausted = await Promise.allSettled([write(next), write(nextCopy)]);
  assert.equal(exhausted.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(exhausted.find(r => r.status === 'rejected').reason), /REANALYSIS_LIMIT_REACHED/);
  assert.equal(await DB.prepare("SELECT count(*) n FROM audit_events WHERE type='PRECEDING_TRANSACTION_EFFECT'").first('n'), 2);
  await assert.rejects(DB.prepare("DELETE FROM audit_events WHERE type='INVOICE_REEVALUATED'").run(), /AUDIT_IMMUTABLE/);
});

test('reanálisis usa reglas actuales, conserva extracción/historial y solo reserva una vez con replay', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  await DB.prepare("UPDATE vendors SET allowed=0 WHERE id='vendor_demo_cloud'").run();
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id, read(extraction(), { provenance: { configVersion: READER_VERSION } }))).data;
  assert.equal(first.latestDecision.action, 'BLOCK');
  const originalRead = await stmt(DB, 'SELECT extracted_json FROM invoices WHERE id=?', invoice.id).first('extracted_json');
  await DB.prepare("UPDATE vendors SET allowed=1 WHERE id='vendor_demo_cloud'").run();
  const key = crypto.randomUUID(); const options = { method: 'POST', key, data: reanalysisInput(first) };
  const updated = await api(`/invoices/${invoice.id}/reevaluate`, options);
  assert.equal(updated.status, 200, JSON.stringify(updated));
  assert.equal(updated.data.latestDecision.action, 'APPROVE');
  assert.equal(updated.data.decisions.length, 2); assert.deepEqual(updated.data.decisions[0], first.decisions[0]);
  assert.equal(await stmt(DB, 'SELECT extracted_json FROM invoices WHERE id=?', invoice.id).first('extracted_json'), originalRead);
  assert.deepEqual((await api(`/invoices/${invoice.id}/reevaluate`, options)).data, updated.data);
  const again = await api(`/invoices/${invoice.id}/reevaluate`, { ...options, key: crypto.randomUUID(), data: reanalysisInput(updated.data) });
  assert.equal(again.status, 409); assert.equal(again.error.code, 'APPROVAL_NOT_ALLOWED');
  assert.deepEqual(await ledger(), { reserved: 20000, reservations: 1, decisions: 2 });
});

test('reanálisis invalida la solicitud anterior y concurrencia no publica dos decisiones', async t => {
  const { env, DB, api, upload, read } = await setup(t);
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id, read(extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' }), { provenance: { configVersion: READER_VERSION } }))).data;
  assert.equal(first.approvalRequest.state, 'PENDING');
  const options = { method: 'POST', data: reanalysisInput(first), key: crypto.randomUUID() };
  const results = await Promise.all([api(`/invoices/${invoice.id}/reevaluate`, options), api(`/invoices/${invoice.id}/reevaluate`, options)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(results[0].data.latestDecision.id, results[1].data.latestDecision.id);
  assert.equal(results[0].data.decisions.length, 2);
  assert.equal(await stmt(DB, 'SELECT state FROM approval_requests WHERE id=?', first.approvalRequest.id).first('state'), 'INVALIDATED');
  assert.equal(await DB.prepare("SELECT count(*) n FROM approval_requests WHERE state='PENDING'").first('n'), 1);
  assert.equal(await DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
});

test('reanálisis rechaza autoridad ajena, estado obsoleto y datos inyectados; lectura antigua sigue en revisión', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id, read(extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' })))).data;
  const path = `/invoices/${invoice.id}/reevaluate`, input = reanalysisInput(first);
  assert.equal((await api(path, { method: 'POST', key: crypto.randomUUID(), data: { ...input, expectedDecisionId: 'stale' } })).error.code, 'DECISION_CHANGED');
  assert.equal((await api(path, { method: 'POST', key: crypto.randomUUID(), data: { ...input, expectedPolicyVersionId: 'stale' } })).error.code, 'POLICY_CHANGED');
  assert.equal((await api(path, { method: 'POST', key: crypto.randomUUID(), data: { ...input, extraction: extraction() } })).status, 400);
  const reviewed = await api(path, { method: 'POST', key: crypto.randomUUID(), data: input });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
  assert.equal(reviewed.data.latestDecision.action, 'ESCALATE'); assert.equal(reviewed.data.approvalRequest.state, 'INVALIDATED');
  assert.equal(reviewed.data.latestDecision.needsHumanApproval, false);
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
  await DB.prepare("UPDATE memberships SET role='APPROVER' WHERE user_id='user_demo_owner'").run();
  assert.equal((await api(path, { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(reviewed.data) })).status, 403);
});

test('reanálisis no revierte un rechazo humano ni resuelve otra identidad por su cuenta', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  const invoice = await upload();
  const first = (await processInvoice(env, 'org_demo', invoice.id,
    read(extraction({ vendorName: 'Acme Accounting (ficticio)', amountMinor: 45000, description: 'Contabilidad mensual ficticia' }), { provenance: { configVersion: READER_VERSION } }))).data;
  const rejected = await api(`/approvals/${first.approvalRequest.id}/decision`, { method: 'POST', key: crypto.randomUUID(),
    data: { action: 'REJECT', comment: 'Rechazo humano que debe conservarse.', ...reanalysisInput(first) } });
  assert.equal(rejected.status, 200);
  const result = await api(`/invoices/${invoice.id}/reevaluate`, { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(rejected.data.invoice) });
  assert.equal(result.status, 409); assert.equal(result.error.code, 'APPROVAL_NOT_ALLOWED');
  const unknown = await upload();
  const blocked = (await processInvoice(env, 'org_demo', unknown.id,
    read(extraction({ vendorName: 'Proveedor nuevo de test' }), { provenance: { configVersion: READER_VERSION } }))).data;
  await DB.prepare("INSERT INTO vendors(id,org_id,name,normalized_name,allowed) VALUES ('new-test-vendor','org_demo','Proveedor nuevo de test','proveedor nuevo de test',1)").run();
  const changed = await api(`/invoices/${unknown.id}/reevaluate`, { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(blocked) });
  assert.equal(changed.status, 409); assert.equal(changed.error.code, 'INVOICE_IDENTITY_CHANGED');
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 3 });
});

test('comprobante legado categórico se bloquea al reanalizar sin reescribir su lectura ni reservar', async t => {
  const { env, DB, api, upload, read, ledger } = await setup(t);
  const invoice = await upload();
  const incomplete = extraction({ vendorName: null, invoiceNumber: null, amountMinor: null, currency: null,
    issuedAt: null, dueDate: null, servicePeriod: null, description: null,
    extractionWarnings: ['Document is a mobile payment receipt, not an invoice; no invoice number, vendor, or due date present.'] });
  const first = (await processInvoice(env, 'org_demo', invoice.id, read(incomplete, { documentType: undefined, corroboration: null,
    provenance: { model: 'deepseek/deepseek-v4.1-flash', configVersion: 'labelled-v3:invoice-json-v2-20261017' } }))).data;
  assert.equal(first.latestDecision.action, 'ESCALATE');
  const original = await stmt(DB, 'SELECT extracted_json FROM invoices WHERE id=?', invoice.id).first('extracted_json');
  const result = await api(`/invoices/${invoice.id}/reevaluate`, { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(first) });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.latestDecision.action, 'BLOCK');
  assert.ok(result.data.latestDecision.reasons.includes('NOT_AN_INVOICE'));
  assert.equal(result.data.latestDecision.trace[0].rule, 'DOCUMENT_TYPE');
  assert.equal(result.data.latestDecision.needsHumanApproval, false);
  assert.equal(result.data.approvalRequest, null); assert.equal(result.data.decisions.length, 2);
  assert.deepEqual(result.data.decisions[0], first.decisions[0]);
  assert.equal(await stmt(DB, 'SELECT extracted_json FROM invoices WHERE id=?', invoice.id).first('extracted_json'), original);
  assert.equal(await stmt(DB, "SELECT json_extract(evidence_json,'$.provenance.documentClassification.source') source FROM decisions WHERE id=?", result.data.latestDecision.id).first('source'), 'LEGACY_NEGATIVE_WARNING');
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

test('tipo no factura bloquea y tipo incierto escala aun con datos financieros completos, sin reservas', async t => {
  const { env, api, upload, read, ledger } = await setup(t);
  for (const documentType of ['PAYMENT_RECEIPT', 'UNKNOWN']) {
    const invoice = await upload({ file: { bytes: new TextEncoder().encode('%PDF-1.4 synthetic type gate ' + documentType) } });
    const result = (await processInvoice(env, 'org_demo', invoice.id,
      read(extraction(), { documentType, provenance: { configVersion: READER_VERSION } }))).data;
    assert.equal(result.latestDecision.action, documentType === 'PAYMENT_RECEIPT' ? 'BLOCK' : 'ESCALATE');
    assert.ok(result.latestDecision.reasons.includes(documentType === 'PAYMENT_RECEIPT' ? 'NOT_AN_INVOICE' : 'DOCUMENT_TYPE_UNCERTAIN'));
    assert.equal(result.latestDecision.trace[0].rule, 'DOCUMENT_TYPE');
    assert.equal(result.latestDecision.needsHumanApproval, false);
    assert.equal(result.approvalRequest, null);
    assert.equal(result.vendorId, null); assert.equal(result.agreementId, null);
    const stored = await api(`/invoices/${invoice.id}`); assert.equal(stored.status, 200);
  }
  assert.deepEqual(await ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

async function prepareReread(t) {
  const s = await setup(t), queued = [];
  s.env.INVOICE_QUEUE = { send: async message => queued.push(message) };
  const invoice = await s.upload();
  const previous = (await processInvoice(s.env, 'org_demo', invoice.id, s.read(extraction({ amountMinor: null }), {
    documentType: undefined, corroboration: null,
  }))).data;
  const { consumeInvoiceJobs } = await import('../worker/jobs.js');
  const message = { body: { kind: 'INVOICE_JOB', jobId: `invoice_job:${invoice.id}` }, ack() {}, retry() { throw new Error('Unexpected queue retry'); } };
  await consumeInvoiceJobs({ messages: [message] }, s.env);
  queued.length = 0;
  return { ...s, previous, invoice, queued, consume: process => consumeInvoiceJobs({ messages: [message] }, s.env, process),
    request: (overrides = {}) => s.api(`/invoices/${invoice.id}/reread`, { method: 'POST', key: crypto.randomUUID(), data: reanalysisInput(previous), ...overrides }) };
}

test('relectura: cola corrige lectura antigua, conserva original/historial y reserva una vez', async t => {
  const s = await prepareReread(t);
  const old = await stmt(s.DB, 'SELECT * FROM invoices WHERE id=?', s.invoice.id).first();
  await assert.rejects(stmt(s.DB, 'UPDATE invoices SET amount_minor=123 WHERE id=?', s.invoice.id).run(), /INVOICE_FACTS_IMMUTABLE/);
  const key = crypto.randomUUID(), requested = await s.request({ key });
  assert.equal(requested.status, 202, JSON.stringify(requested));
  assert.equal(requested.data.status, 'RECEIVED'); assert.equal(requested.data.extraction, null);
  assert.equal(requested.data.latestDecision.id, s.previous.latestDecision.id);
  assert.deepEqual((await s.request({ key })).data, requested.data); assert.equal(s.queued.length, 1);
  await assert.rejects(stmt(s.DB, 'UPDATE invoices SET amount_minor=123 WHERE id=?', s.invoice.id).run(), /INVOICE_FACTS_IMMUTABLE/);
  await s.consume((env, org, invoice) => processInvoice(env, org, invoice, s.read()));
  const detail = (await s.api(`/invoices/${s.invoice.id}`)).data;
  assert.equal(detail.status, 'DECIDED'); assert.equal(detail.latestDecision.action, 'APPROVE');
  assert.equal(detail.extraction.amountMinor, 20000); assert.equal(detail.decisions.length, 2);
  assert.deepEqual(detail.decisions[0], s.previous.latestDecision);
  assert.deepEqual(await s.ledger(), { reserved: 20000, reservations: 1, decisions: 2 });
  assert.equal(await stmt(s.DB, 'SELECT count(*) AS n FROM invoices').first('n'), 1);
  const archive = await stmt(s.DB, 'SELECT * FROM invoice_rereads WHERE invoice_id=?', s.invoice.id).first();
  assert.equal(archive.previous_read_json, old.extracted_json); assert.equal(JSON.parse(archive.previous_facts_json).amount_minor, null);
  const current = await stmt(s.DB, 'SELECT * FROM invoices WHERE id=?', s.invoice.id).first();
  for (const field of ['file_key','file_name','file_sha256','file_size_bytes','file_mime_type']) assert.equal(current[field], old[field]);
  await assert.rejects(stmt(s.DB, 'UPDATE invoices SET amount_minor=123 WHERE id=?', s.invoice.id).run(), /INVOICE_FACTS_IMMUTABLE/);
  await assert.rejects(stmt(s.DB, 'UPDATE invoices SET file_name=? WHERE id=?', 'changed.pdf', s.invoice.id).run(), /INVOICE_FACTS_IMMUTABLE/);
  await assert.rejects(stmt(s.DB, 'DELETE FROM invoice_rereads WHERE id=?', archive.id).run(), /READ_HISTORY_IMMUTABLE/);
  await assert.rejects(stmt(s.DB, 'UPDATE invoice_rereads SET previous_read_json=? WHERE id=?', '{}', archive.id).run(), /READ_HISTORY_IMMUTABLE/);
  assert.equal((await s.request({ data: reanalysisInput(detail) })).status, 409);
});

test('relectura: incertidumbre, prohibición documental y cooldown no se convierten en autorización', async t => {
  const s = await prepareReread(t);
  assert.equal((await s.request()).status, 202);
  await s.consume((env, org, invoice) => processInvoice(env, org, invoice, s.read(extraction(), { corroboration: null })));
  const current = (await s.api(`/invoices/${s.invoice.id}`)).data;
  assert.equal(current.latestDecision.action, 'ESCALATE'); assert.equal(current.approvalRequest, null);
  assert.deepEqual(await s.ledger(), { reserved: 0, reservations: 0, decisions: 2 });
  const cooldown = await s.request({ data: reanalysisInput(current) });
  assert.equal(cooldown.status, 429); assert.equal(cooldown.error.code, 'REANALYSIS_COOLDOWN');
});

test('relectura: valida política, decisión, payload, concurrencia y rol vigente antes de autorizar', async t => {
  const s = await prepareReread(t);
  assert.equal((await s.request({ data: { ...reanalysisInput(s.previous), expectedDecisionId: 'stale' } })).status, 409);
  assert.equal((await s.request({ data: { ...reanalysisInput(s.previous), expectedPolicyVersionId: 'stale' } })).status, 409);
  assert.equal((await s.request({ data: { ...reanalysisInput(s.previous), extraction: extraction() } })).status, 400);
  const results = await Promise.all([s.request(), s.request()]);
  assert.deepEqual(results.map(r => r.status).sort(), [202,409]);
  assert.equal(await stmt(s.DB, 'SELECT count(*) AS n FROM invoice_rereads').first('n'), 1); assert.equal(s.queued.length, 1);
  await stmt(s.DB, "UPDATE memberships SET role='APPROVER' WHERE org_id='org_demo' AND user_id='user_demo_owner'").run();
  await s.consume((env, org, invoice) => processInvoice(env, org, invoice, s.read()));
  assert.equal((await s.request()).status, 403);
  assert.deepEqual(await s.ledger(), { reserved: 0, reservations: 0, decisions: 1 });
});

test('relectura: presupuesto de intentos y jobs terminales no se reinician', async t => {
  const s = await prepareReread(t);
  await stmt(s.DB, 'UPDATE invoice_jobs SET attempts=3 WHERE invoice_id=?', s.invoice.id).run();
  assert.equal((await s.request()).status, 409);
  await assert.rejects(stmt(s.DB, 'UPDATE invoice_jobs SET attempts=0 WHERE invoice_id=?', s.invoice.id).run(), /JOB_ATTEMPTS_IMMUTABLE/);
  await assert.rejects(stmt(s.DB, "UPDATE invoice_jobs SET state='PENDING' WHERE invoice_id=?", s.invoice.id).run(), /JOB_TERMINAL/);
});

test('relectura: un comprobante no factura permanece bloqueado con la nueva lectura', async t => {
  const s = await prepareReread(t);
  assert.equal((await s.request()).status, 202);
  await s.consume((env, org, invoice) => processInvoice(env, org, invoice, s.read(extraction(), { documentType: 'PAYMENT_RECEIPT' })));
  const current = (await s.api(`/invoices/${s.invoice.id}`)).data;
  assert.equal(current.latestDecision.action, 'BLOCK'); assert.ok(current.latestDecision.reasons.includes('NOT_AN_INVOICE'));
  assert.equal(current.approvalRequest, null);
  assert.deepEqual(await s.ledger(), { reserved: 0, reservations: 0, decisions: 2 });
});

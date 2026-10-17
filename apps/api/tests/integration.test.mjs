import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { InvoiceDetailSchema, SessionSchema } from '@oli/contracts';
import worker from '../worker/index.js';
import { processInvoice, snapshot } from '../worker/processing.js';
import { corroboratePdfText, READER_VERSION } from '../worker/document.js';
import { clearGuard, guard, id, now, originCheck, periodKey, stmt } from '../worker/http.js';

const origin = 'https://oli.invalid';
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
    extraction: ex, primaryReadId: crypto.randomUUID(), documentSha256,
    corroboration: corroboratePdfText(text(ex), documentSha256), provenance: { model: 'synthetic-test-only' }, ...changes });
  const ledger = async () => ({
    reserved: await DB.prepare('SELECT coalesce(sum(reserved_minor), 0) AS n FROM budget_periods').first('n'),
    reservations: await DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'),
    decisions: await DB.prepare('SELECT count(*) AS n FROM decisions').first('n'),
  });
  return { env, DB, api, upload, read, ledger, cookie: () => cookie };
}

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
    assert.equal(payload.plugins[0].pdf.engine, 'mistral-ocr');
    assert.ok(payload.messages[1].content.some(c => c.type === 'file'));
    assert.equal(options.body.includes('Demo Cloud Hosting'), false);
    return Response.json({ model: payload.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraction()) } }] });
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

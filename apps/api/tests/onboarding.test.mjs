import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import worker from '../worker/index.js';
import { SAMPLE_VENDOR_SET } from '../../web/src/features/onboarding/sampleSet.ts';

// Controlled reader responses test integration, not OCR accuracy.
test('fresh onboarding: starter directory matches the shipped PDF without a seeded agreement ID', async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'onboarding' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB'), root = new URL('../../../', import.meta.url);
  for (const file of readdirSync(new URL('packages/database/migrations/', root)).filter(f => f.endsWith('.sql')).sort()) {
    await DB.batch(readFileSync(new URL('packages/database/migrations/' + file, root), 'utf8')
      .split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  }
  await DB.batch([
    DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('fresh','Fresh fictitious company','USD','UTC')"),
    DB.prepare("INSERT INTO users(id,name,email) VALUES ('judge','Judge','judge@example.invalid')"),
    DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('fresh','judge','OWNER')"),
  ]);
  const bytes = readFileSync(new URL('examples/invoices/onboarding-hosting.pdf', root));
  const text = [...bytes.toString('ascii').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map(match => match[1].replace(/\\([()\\])/g, '$1')).join('\n');
  assert.ok(!text.includes('agr_demo_cloud'));
  const extraction = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'ONBOARDING-HOSTING-001',
    amountMinor: 20000, currency: 'USD', issuedAt: '2026-10-17', dueDate: '2026-10-31', servicePeriod: '2026-10',
    description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
  t.mock.method(globalThis, 'fetch', async (_url, init) => Response.json({ model: JSON.parse(init.body).model, choices: [{ finish_reason: 'stop',
    message: { content: JSON.stringify({ ...extraction, documentType: 'INVOICE' }) } }] }));
  const origin = 'https://oli.invalid';
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), DEMO_ORG_ID: 'fresh', DEMO_USER_ID: 'judge',
    DEMO_PASSWORD: 'test-only', OPENROUTER_API_KEY: 'test-only', AI: { toMarkdown: async () => ({ format: 'markdown', data: text }) } };
  let cookie = '', csrf = '';
  const api = async (path, method = 'GET', data, form) => {
    const r = await worker.fetch(new Request(origin + '/api/v1' + path, { method,
      headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID(),
        ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: form ?? (data ? JSON.stringify(data) : undefined) }), env);
    const body = await r.json(); assert.ok(r.ok, path + JSON.stringify(body)); return { ...body, headers: r.headers };
  };
  const login = await api('/session', 'POST', { email: 'judge@example.invalid', password: env.DEMO_PASSWORD });
  cookie = login.headers.get('Set-Cookie').split(';')[0]; csrf = login.data.csrfToken;
  assert.deepEqual((await api('/mandate')).data, { active: null, draft: null });
  for (const s of SAMPLE_VENDOR_SET) {
    const vendor = (await api('/vendors', 'POST', { name: s.name, allowed: s.allowed, externalRef: null })).data;
    await api('/agreements', 'POST', { vendorId: vendor.id, currency: 'USD', ...s.agreement, active: true });
  }
  const draft = (await api('/mandate/draft', 'PUT', { expectedRevision: null, basedOnPolicyVersionId: null,
    rules: { currency: 'USD', automaticLimitMinor: 30000, reviewAboveMinor: 30000, hardLimitMinor: 100000,
      monthlyBudgetMinor: 200000, requireAllowedVendor: true, requireAgreement: true, humanApprovalEnabled: true,
      processDaysBeforeDue: 0, scopedDelegations: [] } })).data;
  await api('/mandate/activate', 'POST', { draftId: draft.id, expectedRevision: draft.revision,
    expectedActivePolicyVersionId: null, confirmed: true });
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'onboarding-hosting.pdf');
  const invoice = (await api('/invoices', 'POST', undefined, form)).data;
  const decided = (await api('/invoices/' + invoice.id + '/process', 'POST')).data;
  assert.equal(decided.latestDecision.action, 'APPROVE', JSON.stringify(decided.latestDecision));
  assert.equal(decided.amountMinor, 20000); assert.notEqual(decided.agreementId, 'agr_demo_cloud');
  assert.equal(await DB.prepare("SELECT reserved_minor FROM budget_periods WHERE org_id='fresh'").first('reserved_minor'), 20000);
});

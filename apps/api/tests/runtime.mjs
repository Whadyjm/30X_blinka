import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Miniflare, createFetchMock } from 'miniflare';

test('Worker empaquetado en workerd: sesión, R2, OpenRouter simulado, motor y D1', async t => {
  const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
  const extraction = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'RUNTIME-1', amountMinor: 20000,
    currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
    description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, { model: 'test-vision', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraction) } }] });
  const runtime = new Miniflare({ modules: true, scriptPath: new URL('../.wrangler/runtime/index.js', import.meta.url).pathname,
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'runtime' }, r2Buckets: ['INVOICES'], fetchMock,
    bindings: { DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'test-only', OPENROUTER_API_KEY: 'test-only' } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const file of files) await db.batch(readFileSync(file, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => db.prepare(s)));
  const origin = 'https://oli.invalid';
  const login = await runtime.dispatchFetch(`${origin}/api/v1/session`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@oli-demo.invalid', password: 'test-only' }) });
  assert.equal(login.status, 200); const session = (await login.json()).data;
  const headers = { Origin: origin, Cookie: login.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
  const form = new FormData(); form.append('file', new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' }), 'synthetic.png');
  // Serialize Node's native FormData before crossing Miniflare's Undici boundary.
  const multipart = new Request(`${origin}/api/v1/invoices`, { method: 'POST', body: form });
  const upload = await runtime.dispatchFetch(`${origin}/api/v1/invoices`, { method: 'POST', body: new Uint8Array(await multipart.arrayBuffer()),
    headers: { ...headers, 'Content-Type': multipart.headers.get('Content-Type'), 'Idempotency-Key': crypto.randomUUID() } });
  const uploaded = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploaded)); const invoice = uploaded.data;
  const process = await runtime.dispatchFetch(`${origin}/api/v1/invoices/${invoice.id}/process`, { method: 'POST', headers });
  assert.equal(process.status, 200); const detail = (await process.json()).data;
  assert.equal(detail.status, 'DECIDED'); assert.equal(detail.latestDecision.action, 'ESCALATE');
  assert.equal(detail.approvalRequest, null); assert.equal(detail.decisions.length, 1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 0);
  fetchMock.assertNoPendingInterceptors();
});

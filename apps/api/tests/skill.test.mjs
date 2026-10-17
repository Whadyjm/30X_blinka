import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { CreatedSkillConnectionSchema, InvoiceDetailSchema, InvoiceSchema, SkillIntegrationSchema } from '@oli/contracts';
import worker from '../worker/index.js';
import { sha256 } from '../worker/http.js';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = 'https://oli.invalid';
const pdf = new TextEncoder().encode('%PDF-1.4\nFictitious skill fixture; no external model used.');

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'skill' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const paths = readdirSync(new URL('migrations/', root)).filter(p => p.endsWith('.sql')).sort().map(p => `migrations/${p}`);
  for (const path of [...paths, 'seed/demo.sql']) {
    await DB.batch(readFileSync(new URL(path, root), 'utf8').split('\n-- statement-breakpoint\n').map(s => s.trim()).filter(Boolean).map(sql => DB.prepare(sql)));
  }
  const jobs = [], bucket = await runtime.getR2Bucket('INVOICES');
  const env = { DB, INVOICES: bucket, INVOICE_QUEUE: { send: async body => jobs.push(body) },
    DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'synthetic-test' };
  const login = await worker.fetch(new Request(`${origin}/api/v1/session`, { method: 'POST', headers: { Origin: origin },
    body: JSON.stringify({ email: 'owner@oli-demo.invalid', password: env.DEMO_PASSWORD }) }), env);
  const session = (await login.json()).data;
  const humanHeaders = { Cookie: login.headers.get('Set-Cookie').split(';')[0], Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const send = async (path, method = 'GET', { data, token, file, key, human = false, headers = {} } = {}) => {
    let payload = data === undefined ? undefined : JSON.stringify(data);
    if (file) { payload = new FormData(); payload.append('file', new Blob([file.bytes ?? pdf], { type: file.type ?? 'application/pdf' }), file.name ?? 'fictitious.pdf'); }
    const response = await worker.fetch(new Request(`${origin}/api/v1${path}`, { method, body: payload, headers: {
      ...(human ? humanHeaders : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...headers,
    } }), env);
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  const create = async (name = 'Hermes Marketing') => {
    const result = await send('/integrations/skill/connections', 'POST', { human: true, data: { name } });
    assert.equal(result.status, 201); return CreatedSkillConnectionSchema.parse(result.body.data);
  };
  const upload = (token, key = crypto.randomUUID(), file = {}) => send('/agent/invoices', 'POST', { token, key, file });
  return { env, DB, send, create, upload, jobs, bucket };
}

test('Skill: owner + CSRF; keys returned once, hash stored, no expiry by default', async t => {
  const s = await setup(t);
  assert.equal((await s.send('/integrations/skill')).status, 401);
  assert.equal((await s.send('/integrations/skill/connections', 'POST', { human: true, data: { name: 'x' }, headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await s.send('/integrations/skill/connections', 'POST', { human: true, data: { name: 'x', scopes: ['OWNER'] } })).status, 400);
  const created = await s.create();
  assert.equal(created.connection.expiresAt, null);
  const row = await s.DB.prepare('SELECT * FROM agent_connections').first();
  assert.equal(row.token_hash, await sha256(created.apiKey));
  assert.ok(!JSON.stringify(row).includes(created.apiKey));
  const list = await s.send('/integrations/skill', 'GET', { human: true });
  SkillIntegrationSchema.parse(list.body.data);
  assert.ok(!JSON.stringify(list.body).includes(created.apiKey));
  assert.match(list.headers.get('Cache-Control'), /no-store/);
  await s.DB.prepare("UPDATE memberships SET role = 'APPROVER' WHERE org_id = 'org_demo'").run();
  assert.equal((await s.send('/integrations/skill/connections', 'POST', { human: true, data: { name: 'no' } })).status, 403);
  assert.equal((await s.send('/agent/me', 'GET', { token: created.apiKey })).status, 401);
});

test('Skill: authenticated identity, editable nullable expiry and irreversible revocation', async t => {
  const s = await setup(t), a = await s.create();
  assert.equal((await s.send('/agent/me')).status, 401);
  const check = await s.send('/agent/me', 'GET', { token: a.apiKey });
  assert.equal(check.status, 200); assert.equal(check.body.data.simulated, true);
  assert.equal(check.body.data.organization.id, 'org_demo');
  const path = `/integrations/skill/connections/${a.connection.id}`;
  assert.equal((await s.send(path, 'PATCH', { human: true, data: { expiresAt: 'tomorrow' } })).status, 400);
  assert.equal((await s.send(path, 'PATCH', { human: true, data: { expiresAt: '2000-01-01T00:00:00.000Z' } })).status, 200);
  assert.equal((await s.send('/agent/me', 'GET', { token: a.apiKey })).status, 401);
  await s.send(path, 'PATCH', { human: true, data: { expiresAt: null } });
  assert.equal((await s.send('/agent/me', 'GET', { token: a.apiKey })).status, 200);
  assert.equal((await s.send(path, 'DELETE', { human: true })).status, 204);
  assert.equal((await s.send('/agent/me', 'GET', { token: a.apiKey })).status, 401);
  assert.equal((await s.send(path, 'PATCH', { human: true, data: { expiresAt: null } })).status, 409);
  assert.equal((await s.send(path, 'DELETE', { human: true })).status, 204);
});

test('Skill: scoped invoice upload, idempotency per connection, provenance and queue reuse', async t => {
  const s = await setup(t), a = await s.create(), b = await s.create('OpenClaw Marketing'), key = crypto.randomUUID();
  const first = await s.upload(a.apiKey, key); assert.equal(first.status, 201);
  InvoiceSchema.parse(first.body.data); assert.equal(first.body.data.source, 'AGENT_REQUEST');
  const invoiceId = first.body.data.id;
  assert.equal((await s.upload(a.apiKey, key)).body.data.id, invoiceId);
  assert.equal((await s.upload(a.apiKey, key, { name: 'different.pdf' })).status, 409);
  const second = await s.upload(b.apiKey, key); assert.equal(second.status, 201);
  assert.notEqual(second.body.data.id, invoiceId);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 2);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM agent_invoice_sources').first('n'), 2);
  const detail = await s.send(`/agent/invoices/${invoiceId}`, 'GET', { token: a.apiKey });
  assert.equal(detail.status, 200); InvoiceDetailSchema.parse(detail.body.data);
  const fromUi = await s.send(`/invoices/${invoiceId}`, 'GET', { human: true });
  assert.equal(fromUi.body.data.source, 'AGENT_REQUEST');
  const evaluated = await s.send(`/agent/invoices/${invoiceId}/process`, 'POST', { token: a.apiKey });
  assert.equal(evaluated.status, 202);
  assert.ok(s.jobs.length > 0);
  assert.equal((await s.send(`/agent/invoices/${invoiceId}/process`, 'POST', { token: a.apiKey, data: { approved: true } })).status, 400);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM decisions').first('n'), 0);
  const audits = (await s.DB.prepare("SELECT * FROM audit_events WHERE type = 'INVOICE_RECEIVED'").all()).results;
  assert.equal(audits[0].actor_kind, 'SYSTEM');
  assert.equal(JSON.parse(audits[0].details_json).connectionId, a.connection.id);
  assert.ok(!JSON.stringify(audits).includes(a.apiKey));
  await assert.rejects(s.DB.prepare('DELETE FROM agent_invoice_sources').run(), /SOURCE_IMMUTABLE/);
});

test('Skill: other agents, UI invoices, other companies and human mutations stay inaccessible', async t => {
  const s = await setup(t), a = await s.create(), b = await s.create('Grokbot');
  const uploaded = await s.upload(a.apiKey), id = uploaded.body.data.id;
  assert.equal((await s.send(`/agent/invoices/${id}`, 'GET', { token: b.apiKey })).status, 404);
  assert.equal((await s.send(`/agent/invoices/${id}/process`, 'POST', { token: b.apiKey })).status, 404);
  const ui = await s.send('/invoices', 'POST', { human: true, file: {}, key: crypto.randomUUID() });
  assert.equal((await s.send(`/agent/invoices/${ui.body.data.id}`, 'GET', { token: a.apiKey })).status, 404);
  for (const path of ['/me', '/invoices', '/mandate', '/integrations/skill']) {
    assert.equal((await s.send(path, 'GET', { token: a.apiKey })).status, 401, path);
  }
  for (const path of ['/agent/invoices', '/agent/mandate', '/agent/chat/actions/x/confirm', '/agent/approvals/x/decision', `/agent/invoices/${id}/file`]) {
    assert.equal((await s.send(path, 'GET', { token: a.apiKey })).status, 403, path);
  }
  await s.DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Other','USD','UTC')").run();
  await s.DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('other','user_demo_owner','OWNER')").run();
  await s.DB.prepare('UPDATE agent_connections SET org_id = ? WHERE id = ?').bind('other', b.connection.id).run();
  assert.equal((await s.send(`/agent/invoices/${id}`, 'GET', { token: b.apiKey })).status, 404);
  assert.equal((await s.send(`/integrations/skill/connections/${b.connection.id}`, 'DELETE', { human: true })).status, 404);
});

test('Skill: rate limit is atomic and its next window recovers', async t => {
  const s = await setup(t), a = await s.create();
  await s.send('/agent/me', 'GET', { token: a.apiKey });
  await s.DB.prepare('UPDATE agent_request_limits SET requests = 60').run();
  const response = await s.send('/agent/me', 'GET', { token: a.apiKey });
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
  await s.DB.prepare('UPDATE agent_request_limits SET window_start = 0').run();
  assert.equal((await s.send('/agent/me', 'GET', { token: a.apiKey })).status, 200);
});

test('Skill: revocation during upload rejects the commit and removes the R2 object', async t => {
  const s = await setup(t), a = await s.create(); let objectKey;
  s.env.INVOICES = { put: async (...args) => {
    objectKey = args[0]; await s.bucket.put(...args);
    await s.DB.prepare('UPDATE agent_connections SET revoked_at = ? WHERE id = ?').bind(new Date().toISOString(), a.connection.id).run();
  }, delete: (...args) => s.bucket.delete(...args) };
  assert.equal((await s.upload(a.apiKey)).status, 401);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 0);
  assert.equal(await s.bucket.get(objectKey), null);
});

test('Skill client: real Python upload/check/process/status, retained retry key and no redirect leakage', async t => {
  const s = await setup(t), a = await s.create();
  const dir = await mkdtemp(join(tmpdir(), 'oli-skill-client-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'fictitious.pdf'); await writeFile(file, pdf);
  let redirects = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['user-agent'], 'Oli-Skill/1.0');
    if (req.url === '/stolen') { redirects++; res.end('{}'); return; }
    if (req.headers.authorization === 'Bearer oli_sk_' + 'a'.repeat(64)) {
      res.writeHead(302, { Location: '/stolen' }); res.end(); return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) }), s.env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/agent`;
  const client = new URL('../../web/public/skills/oli/scripts/oli.py', import.meta.url).pathname;
  const run = (args, key = a.apiKey) => promisify(execFile)('python3', [client, ...args], {
    env: { PATH: process.env.PATH, OLI_API_URL: base, OLI_API_KEY: key }, timeout: 20000,
  });
  const check = await run(['check']); assert.equal(JSON.parse(check.stdout).data.connection.name, 'Hermes Marketing');
  assert.ok(!check.stdout.includes(a.apiKey));
  const operation = crypto.randomUUID();
  const first = JSON.parse((await run(['upload', file, '--operation-key', operation])).stdout).data;
  const again = JSON.parse((await run(['upload', file, '--operation-key', operation])).stdout).data;
  assert.equal(again.id, first.id);
  await run(['process', first.id]);
  assert.equal(JSON.parse((await run(['status', first.id])).stdout).data.source, 'AGENT_REQUEST');
  await assert.rejects(run(['check'], 'oli_sk_' + 'a'.repeat(64)), error => {
    assert.match(error.stderr, /HTTP_302/); assert.ok(!error.stderr.includes('a'.repeat(64))); return true;
  });
  assert.equal(redirects, 0);
  await assert.rejects(run(['upload', file]), error => { assert.match(error.stderr, /operation-key/); return true; });
});

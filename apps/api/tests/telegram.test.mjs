import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import worker from '../worker/index.js';
import { consumeTelegram } from '../worker/telegram.js';
import { sha256, stmt } from '../worker/http.js';
import { processInvoice } from '../worker/processing.js';
import { corroboratePdfText } from '../worker/document.js';

const origin = 'https://oli.invalid';
const path = '/api/channels/telegram/webhook';
const pdf = new TextEncoder().encode('%PDF-1.4\nsynthetic Telegram fixture');
const ex = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'TELEGRAM-TEST-1', amountMinor: 20000,
  currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
  description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
const processing = (env, org, invoice) => processInvoice(env, org, invoice, async (_env, _file, _bytes, hash) => ({
  extraction: ex, primaryReadId: 'synthetic-primary', documentSha256: hash,
  corroboration: corroboratePdfText(`EMISOR / SUPPLIER\n${ex.vendorName}\nMoneda / Currency\nUSD\nVencimiento / Due\n${ex.dueDate}\nTOTAL A COBRAR\nUSD 200.00`, hash),
}));

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'telegram' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const file of files) await DB.batch(readFileSync(file, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  const queue = [], sent = [], calls = [];
  let failSend = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.telegram.org');
    if (u.pathname.startsWith('/file/')) { calls.push('download'); return new Response(pdf); }
    const method = u.pathname.split('/').at(-1);
    calls.push(method);
    if (method === 'sendMessage') {
      if (failSend) { failSend = false; return Response.json({ ok: false }, { status: 503 }); }
      sent.push(JSON.parse(options.body));
    }
    return Response.json({ ok: true, result: method === 'getMe' ? { username: 'OliTestBot' }
      : method === 'getFile' ? { file_path: 'documents/test.pdf', file_size: pdf.length } : true });
  });
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), PUBLIC_APP_URL: origin,
    TELEGRAM_BOT_TOKEN: '123456:synthetic-test-token', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    TELEGRAM_QUEUE: { send: async payload => queue.push(payload) },
    DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'synthetic-test' };
  const login = await worker.fetch(new Request(`${origin}/api/v1/session`, { method: 'POST', headers: { Origin: origin },
    body: JSON.stringify({ email: 'owner@oli-demo.invalid', password: env.DEMO_PASSWORD }) }), env);
  const session = (await login.json()).data;
  const headers = { Cookie: login.headers.get('Set-Cookie').split(';')[0], Origin: origin, 'X-CSRF-Token': session.csrfToken };
  const api = (route, method = 'GET', overrides = {}) => worker.fetch(new Request(`${origin}/api/v1${route}`, {
    method, headers: { ...headers, ...overrides },
  }), env);
  const link = async () => {
    const response = await api('/integrations/telegram/link', 'POST');
    assert.equal(response.status, 201);
    return (await response.json()).data;
  };
  const webhook = (update, secret = env.TELEGRAM_WEBHOOK_SECRET) => worker.fetch(new Request(`${origin}${path}`, {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update),
  }), env);
  let sequence = 0;
  const update = (fields = {}, userId = 101) => ({ update_id: ++sequence, message: {
    from: { id: userId, first_name: 'Oscar', is_bot: false }, chat: { id: userId, type: 'private' }, ...fields,
  } });
  const drain = async (process = processing, attempts = 1) => {
    const jobs = queue.splice(0);
    const results = [];
    for (const body of jobs) {
      const state = { ack: false, retry: false };
      await consumeTelegram({ messages: [{ body, attempts, ack: () => { state.ack = true; }, retry: () => { state.retry = true; queue.push(body); } }] }, env, process);
      results.push(state);
    }
    return results;
  };
  const connect = async () => {
    const value = await link(); const token = new URL(value.url).searchParams.get('start');
    await webhook(update({ text: `/start ${token}` })); await drain(); return token;
  };
  return { env, DB, api, link, webhook, update, drain, connect, queue, sent, calls, failNextSend: () => { failSend = true; } };
}

test('Telegram: sesión/CSRF y autenticación del webhook; grupos y eventos inválidos no se encolan', async t => {
  const s = await setup(t);
  assert.equal((await s.api('/integrations/telegram', 'GET', { Cookie: '' })).status, 401);
  assert.equal((await s.api('/integrations/telegram/link', 'POST', { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await s.webhook(s.update(), 'bad')).status, 403);
  assert.equal((await s.webhook({ update_id: -1 })).status, 400);
  assert.equal((await s.webhook(s.update({ chat: { id: -1, type: 'group' } }))).status, 200);
  assert.equal(s.queue.length, 0);
  delete s.env.TELEGRAM_BOT_TOKEN;
  assert.equal((await s.api('/integrations/telegram')).status, 200);
  assert.equal((await (await s.api('/integrations/telegram')).json()).data.available, false);
  assert.equal((await s.api('/integrations/telegram/link', 'POST')).status, 503);
});

test('Telegram: código aleatorio, solo hash almacenado, uso único, caducidad y desconexión', async t => {
  const s = await setup(t);
  const first = await s.link(); const token = new URL(first.url).searchParams.get('start');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal((await s.DB.prepare('SELECT token_hash FROM telegram_link_tokens').first()).token_hash, await sha256(token));
  const event = s.update({ text: `/start ${token}` });
  await s.webhook(event); await s.drain();
  const status = (await (await s.api('/integrations/telegram')).json()).data;
  assert.equal(status.connection.displayName, 'Oscar');
  assert.match(s.sent.at(-1).text, /Conectado a/);
  assert.ok(!(await s.DB.prepare('SELECT payload_json FROM telegram_events').first()).payload_json.includes(token));
  await s.webhook(s.update({ text: `/start ${token}` }, 202)); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM telegram_connections').first('n'), 1);
  assert.match(s.sent.at(-1).text, /No pude vincular/);
  assert.equal((await s.api('/integrations/telegram/link', 'POST')).status, 409);
  assert.equal((await s.api('/integrations/telegram', 'DELETE')).status, 204);
  await s.webhook(s.update({ text: `/start ${token}` })); await s.drain();
  assert.equal((await (await s.api('/integrations/telegram')).json()).data.connection, null);
  const expired = new URL((await s.link()).url).searchParams.get('start');
  await s.DB.prepare("UPDATE telegram_link_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE connection_id IS NULL").run();
  await s.webhook(s.update({ text: `/start ${expired}` })); await s.drain();
  assert.equal((await (await s.api('/integrations/telegram')).json()).data.connection, null);
});

test('Telegram: detecta credenciales inválidas sin exponer secretos y admite espacios de copiado', async t => {
  const s = await setup(t);
  s.env.TELEGRAM_BOT_TOKEN = ` ${s.env.TELEGRAM_BOT_TOKEN}\n`;
  s.env.TELEGRAM_WEBHOOK_SECRET = ` ${s.env.TELEGRAM_WEBHOOK_SECRET}\n`;
  assert.equal((await s.api('/integrations/telegram/link', 'POST')).status, 201);
  s.env.TELEGRAM_WEBHOOK_SECRET = 'invalid webhook secret';
  let response = await s.api('/integrations/telegram/link', 'POST');
  assert.equal((await response.json()).error.code, 'TELEGRAM_WEBHOOK_SECRET_INVALID');
  s.env.TELEGRAM_BOT_TOKEN = 'not-a-bot-token';
  response = await s.api('/integrations/telegram/link', 'POST');
  const payload = await response.text();
  assert.match(payload, /TELEGRAM_BOT_TOKEN_INVALID/); assert.ok(!payload.includes(s.env.TELEGRAM_BOT_TOKEN));
});

test('Telegram: saludar o /start sin código reconoce el vínculo y no pide conectarse otra vez', async t => {
  const s = await setup(t);
  await s.webhook(s.update({ text: 'hola' })); await s.drain();
  assert.match(s.sent.at(-1).text, /Conecta tu cuenta en Integraciones/);
  await s.connect();
  for (const text of ['hola', '/start', '/help']) {
    await s.webhook(s.update({ text })); await s.drain();
    assert.match(s.sent.at(-1).text, /Ya estás conectado con Oli/);
    assert.match(s.sent.at(-1).text, /PDF, JPG o PNG/);
    assert.ok(!s.sent.at(-1).text.includes('/app/integrations'));
  }
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 0);
});

test('Telegram: texto encolado durante la vinculación y reintentos consultan la conexión vigente', async t => {
  const s = await setup(t);
  const token = new URL((await s.link()).url).searchParams.get('start');
  await s.webhook(s.update({ text: `/start ${token}` }));
  await s.webhook(s.update({ text: 'hola' }));
  await s.drain();
  assert.match(s.sent.at(-1).text, /Ya estás conectado con Oli/);
  await s.webhook(s.update({ text: '/start' }));
  s.failNextSend(); await s.drain();
  await s.api('/integrations/telegram', 'DELETE');
  await s.drain(undefined, 2);
  assert.match(s.sent.at(-1).text, /Conecta tu cuenta en Integraciones/);
});

test('Telegram: reintentos no duplican documento/decisión/reserva; otro envío del mismo PDF se bloquea', async t => {
  const s = await setup(t); await s.connect();
  const event = s.update({ document: { file_id: 'file-1', file_name: 'factura.pdf', mime_type: 'application/pdf', file_size: pdf.length } });
  await s.webhook(event); await s.webhook(event);
  await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM decisions').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 1);
  const invoice = (await (await s.api('/invoices')).json()).data[0];
  assert.equal(invoice.source, 'TELEGRAM'); assert.equal(invoice.latestDecision.action, 'APPROVE');
  assert.match(s.sent.at(-1).text, /Factura aprobada/);
  await s.webhook(s.update(event.message)); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 2);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 1);
  assert.match(s.sent.at(-1).text, /Factura bloqueada/);
});

test('Telegram: fallo de respuesta reintenta notificación sin volver a procesar', async t => {
  const s = await setup(t); await s.connect();
  await s.webhook(s.update({ document: { file_id: 'file-1', mime_type: 'application/pdf', file_name: 'f.pdf' } }));
  s.failNextSend();
  assert.equal((await s.drain())[0].retry, true);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM decisions').first('n'), 1);
  await s.drain(() => assert.fail('No debe procesar al reintentar una notificación'), 2);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM decisions').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT state FROM telegram_events ORDER BY update_id DESC LIMIT 1').first('state'), 'DONE');
});

test('Telegram: sin vínculo o tras desconexión no descarga facturas; límite antes de descargar', async t => {
  const s = await setup(t);
  const doc = { document: { file_id: 'file-1', mime_type: 'application/pdf', file_name: 'f.pdf' } };
  await s.webhook(s.update(doc, 202)); await s.drain();
  assert.equal(s.calls.includes('getFile'), false);
  await s.connect();
  await s.webhook(s.update({ document: { ...doc.document, file_size: 5242881 } })); await s.drain();
  assert.equal(s.calls.includes('getFile'), false);
  await s.webhook(s.update(doc));
  await s.api('/integrations/telegram', 'DELETE'); await s.drain();
  assert.equal(s.calls.includes('getFile'), false);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 0);
});

test('Telegram: no reasigna un Telegram a otra empresa; vínculo del evento conserva identidad original', async t => {
  const s = await setup(t); await s.connect();
  await s.DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Otra empresa','USD','UTC')").run();
  await s.DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('other','user_demo_owner','OWNER')").run();
  const token = 'b'.repeat(64);
  await stmt(s.DB, 'INSERT INTO telegram_link_tokens(token_hash,org_id,user_id,expires_at) VALUES (?, ?, ?, ?)',
    await sha256(token), 'other', 'user_demo_owner', new Date(Date.now() + 60000).toISOString()).run();
  await s.webhook(s.update({ text: `/start ${token}` })); await s.drain();
  assert.equal(await s.DB.prepare("SELECT count(*) AS n FROM telegram_connections WHERE org_id = 'other'").first('n'), 0);
  assert.equal(await s.DB.prepare("SELECT count(*) AS n FROM telegram_connections WHERE org_id = 'org_demo' AND revoked_at IS NULL").first('n'), 1);
});

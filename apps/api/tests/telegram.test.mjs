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
  extraction: ex, documentType: 'INVOICE', primaryReadId: 'synthetic-primary', documentSha256: hash,
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
  const queue = [], sent = [], calls = [], modelCalls = [], modelSteps = [];
  let failSend = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url);
    if (u.origin === 'https://openrouter.ai') {
      modelCalls.push(JSON.parse(options.body));
      const step = modelSteps.shift() ?? { content: '¡Hola! ¿Revisamos tus facturas o el presupuesto?' };
      return step instanceof Response ? step : Response.json({ choices: [{ finish_reason: step.tool_calls ? 'tool_calls' : 'stop', message: step }] });
    }
    assert.equal(u.origin, 'https://api.telegram.org');
    if (u.pathname.startsWith('/file/')) { calls.push('download'); return new Response(pdf); }
    const method = u.pathname.split('/').at(-1);
    calls.push(method);
    if (method === 'sendMessage') {
      if (failSend > 0 && --failSend === 0) return Response.json({ ok: false }, { status: 503 });
      sent.push(JSON.parse(options.body));
    }
    return Response.json({ ok: true, result: method === 'getMe' ? { username: 'OliTestBot' }
      : method === 'getFile' ? { file_path: 'documents/test.pdf', file_size: pdf.length }
        : method === 'sendMessage' ? { message_id: sent.length } : true });
  });
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), PUBLIC_APP_URL: origin,
    TELEGRAM_BOT_TOKEN: '123456:synthetic-test-token', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    TELEGRAM_QUEUE: { send: async payload => queue.push(payload) }, OPENROUTER_API_KEY: 'synthetic-chat-key',
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
  const click = (button, messageId = sent.length, userId = 101) => webhook({ update_id: ++sequence, callback_query: {
    id: `callback-${sequence}`, from: { id: userId, is_bot: false }, data: button.callback_data,
    message: { message_id: messageId, from: { id: 999, is_bot: true }, chat: { id: userId, type: 'private' } },
  } });
  return { env, DB, api, link, webhook, update, drain, connect, queue, sent, calls, modelCalls, modelSteps, click, failNextSend: (after = 0) => { failSend = after + 1; } };
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

test('Telegram: hola, /start y /help conversan con el modelo, conservan historial y no piden otra conexión', async t => {
  const s = await setup(t);
  await s.webhook(s.update({ text: 'hola' })); await s.drain();
  assert.match(s.sent.at(-1).text, /Conecta tu cuenta en Integraciones/);
  await s.connect();
  for (const text of ['hola', '/start', '/help']) {
    await s.webhook(s.update({ text })); await s.drain();
    assert.match(s.sent.at(-1).text, /¡Hola!/);
    assert.ok(!s.sent.at(-1).text.includes('/app/integrations'));
  }
  assert.equal(s.modelCalls.length, 3);
  const messages = s.modelCalls.at(-1).messages;
  assert.equal(messages.filter(m => m.role === 'assistant').length, 2);
  assert.match(messages[0].content, /Estás en Telegram/);
  assert.match(messages[0].content, /Si piden algo ajeno/);
  assert.match(messages[0].content, /Un sí escrito/);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM telegram_conversations').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM invoices').first('n'), 0);
});

test('Telegram: texto encolado durante la vinculación y reintentos consultan la conexión vigente', async t => {
  const s = await setup(t);
  const token = new URL((await s.link()).url).searchParams.get('start');
  await s.webhook(s.update({ text: `/start ${token}` }));
  await s.webhook(s.update({ text: 'hola' }));
  await s.drain();
  assert.match(s.sent.at(-1).text, /¡Hola!/);
  await s.webhook(s.update({ text: '/start' }));
  s.failNextSend(); await s.drain();
  await s.api('/integrations/telegram', 'DELETE');
  const sent = s.sent.length, modelCalls = s.modelCalls.length;
  await s.drain(undefined, 2);
  assert.equal(s.sent.length, sent);
  assert.equal(s.modelCalls.length, modelCalls);
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

const tool = (name, args) => ({ content: null, tool_calls: [{ id: crypto.randomUUID(), type: 'function',
  function: { name, arguments: JSON.stringify(args) } }] });
const vendor = { name: 'Proveedor creado desde Telegram', allowed: true, externalRef: null };
async function propose(s) {
  s.modelSteps.push(tool('prepare_change', { proposal: { kind: 'CREATE_VENDOR', data: vendor } }), { content: 'Revisa la propuesta y pulsa Confirmar.' });
  await s.webhook(s.update({ text: 'Registra este proveedor, autorizado, sin referencia externa.' }));
  await s.drain();
  const messageId = s.sent.length, message = s.sent.at(-1);
  assert.match(message.text, /Proveedor creado desde Telegram/);
  return { messageId, confirm: message.reply_markup.inline_keyboard[0][0], cancel: message.reply_markup.inline_keyboard[0][1] };
}

test('Telegram: herramientas leen D1 de la empresa, historial y adjuntos no cruzan conexiones', async t => {
  const s = await setup(t); await s.connect();
  s.modelSteps.push(tool('list_vendors', {}), { content: 'Estos son tus proveedores registrados.' });
  await s.webhook(s.update({ text: '¿Qué proveedores tengo?' })); await s.drain();
  const toolResult = JSON.parse(s.modelCalls.at(-1).messages.find(m => m.role === 'tool').content);
  assert.ok(toolResult.vendors.some(v => v.name === ex.vendorName));
  await s.webhook(s.update({ document: { file_id: 'context-file', mime_type: 'application/pdf', file_name: 'factura.pdf' } })); await s.drain();
  await s.webhook(s.update({ text: '¿Por qué tomó esa decisión?' })); await s.drain();
  const input = JSON.parse(s.modelCalls.at(-1).messages.at(-1).content);
  assert.equal(input.attachedInvoices.length, 1);
  assert.equal(input.attachedInvoices[0].invoice.latestDecision.action, 'APPROVE');
  await s.DB.batch([
    s.DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Otra empresa','USD','UTC')"),
    s.DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('other','user_demo_owner','OWNER')"),
    s.DB.prepare("INSERT INTO telegram_connections(id,org_id,user_id,telegram_user_id,chat_id,display_name,connected_at) VALUES ('tg_second','other','user_demo_owner','202','202','Otro',?)").bind(new Date().toISOString()),
  ]);
  s.modelSteps.push(tool('list_vendors', {}), { content: 'Esta empresa no tiene proveedores registrados.' });
  await s.webhook(s.update({ text: 'Hola, lista proveedores' }, 202)); await s.drain();
  const other = s.modelCalls.at(-1).messages;
  assert.match(other[0].content, /Otra empresa/);
  assert.equal(other.filter(m => m.role === 'assistant' && !m.tool_calls).length, 0);
  assert.equal(JSON.parse(other.find(m => m.role === 'user').content).attachedInvoices.length, 0);
  assert.deepEqual(JSON.parse(other.find(m => m.role === 'tool').content).vendors, []);
});

test('Telegram: modelo propone, sí escrito no ejecuta, solo botón propio confirmado aplica una vez', async t => {
  const s = await setup(t); await s.connect();
  const baseline = await s.DB.prepare('SELECT count(*) AS n FROM vendors').first('n');
  const offer = await propose(s);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM vendors').first('n'), baseline);
  assert.equal(await s.DB.prepare('SELECT state FROM chat_actions').first('state'), 'PENDING');
  await s.webhook(s.update({ text: 'sí, hazlo' })); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM vendors').first('n'), baseline);
  await s.click(offer.confirm, offer.messageId, 202); await s.drain();
  await s.click(offer.confirm, offer.messageId + 1); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM vendors').first('n'), baseline);
  await s.click(offer.confirm, offer.messageId); await s.drain();
  assert.match(s.sent.at(-1).text, /Cambio confirmado/);
  await s.click(offer.confirm, offer.messageId); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM vendors').first('n'), baseline + 1);
  assert.equal(await s.DB.prepare("SELECT count(*) AS n FROM audit_events WHERE type = 'CHAT_ACTION_CONFIRMED'").first('n'), 1);
});

test('Telegram: cancelar, cambio de rol, cambios de datos o revocación impiden confirmar', async t => {
  const s = await setup(t); await s.connect();
  let offer = await propose(s);
  await s.click(offer.cancel, offer.messageId); await s.drain();
  await s.click(offer.confirm, offer.messageId); await s.drain();
  assert.match(s.sent.at(-1).text, /No se pudo aplicar/);
  offer = await propose(s);
  await s.DB.prepare("UPDATE organizations SET state_revision = state_revision + 1 WHERE id = 'org_demo'").run();
  await s.click(offer.confirm, offer.messageId); await s.drain();
  assert.match(s.sent.at(-1).text, /No se pudo aplicar/);
  offer = await propose(s);
  await s.DB.prepare("UPDATE memberships SET role = 'APPROVER' WHERE org_id = 'org_demo' AND user_id = 'user_demo_owner'").run();
  assert.equal((await s.api('/integrations/telegram/setup', 'POST')).status, 403);
  await s.click(offer.confirm, offer.messageId); await s.drain();
  assert.match(s.sent.at(-1).text, /Tu rol no permite/);
  await s.webhook(s.update({ text: 'Hola' })); await s.drain();
  assert.ok(!s.modelCalls.at(-1).tools.some(t => t.function.name === 'prepare_change'));
  await s.click(offer.confirm, offer.messageId);
  await s.api('/integrations/telegram', 'DELETE'); await s.drain();
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM vendors WHERE name = ?').bind(vendor.name).first('n'), 0);
});

test('Telegram: respuesta larga y reintento de entrega conservan partes y no vuelven a llamar al modelo', async t => {
  const s = await setup(t); await s.connect();
  const text = '🙂'.repeat(1900) + ' final';
  s.modelSteps.push({ content: text });
  const event = s.update({ text: 'hola' });
  await s.webhook(event); await s.webhook(event);
  const baseline = s.sent.length;
  s.failNextSend(1); await s.drain();
  // The duplicate queue receipt retries the saved second part, never the first part or provider.
  await s.drain(undefined, 2);
  assert.equal(s.modelCalls.length, 1);
  assert.equal(s.sent.slice(baseline).map(p => p.text).join(''), text);
  assert.ok(s.sent.slice(baseline).every(p => p.text.length <= 4096));
});

test('Telegram: mensajes grandes y fallo de proveedor dan respuesta acotada sin cambios ni reintentos caros', async t => {
  const s = await setup(t); await s.connect();
  await s.webhook(s.update({ text: 'x'.repeat(5000) })); await s.drain();
  assert.equal(s.modelCalls.length, 0);
  assert.match(s.sent.at(-1).text, /4000 caracteres/);
  s.modelSteps.push(Response.json({ error: 'unavailable' }, { status: 503 }));
  const event = s.update({ text: 'hola' });
  await s.webhook(event); s.failNextSend(); await s.drain(); await s.drain(undefined, 2);
  assert.equal(s.modelCalls.length, 1);
  assert.match(s.sent.at(-1).text, /No pude completar la respuesta/);
  assert.equal(await s.DB.prepare('SELECT count(*) AS n FROM chat_actions').first('n'), 0);
  assert.equal(await s.DB.prepare('SELECT state FROM telegram_events WHERE update_id = ?').bind(event.update_id).first('state'), 'DONE');
});

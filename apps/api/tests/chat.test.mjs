import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { ChatReplySchema, ChatActionResultSchema } from '@oli/contracts';
import worker from '../worker/index.js';
import { processInvoice } from '../worker/processing.js';
import { corroboratePdfText } from '../worker/document.js';
import { runTool } from '../worker/chat-tools.js';
import { chatMessage } from '../worker/chat.js';

const origin = 'https://oli.invalid';
const vendor = { name: 'Faro Telecom Demo', allowed: true, externalRef: null };
const agreement = { currency: 'USD', amountMinor: 8900, toleranceMinor: 0, frequency: 'MONTHLY', concept: 'Internet ficticio', active: true };

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'chat' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const f of files) await DB.batch(readFileSync(f, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'test-only', OPENROUTER_API_KEY: 'test-provider-key' };
  let cookie = '', csrf = '', session;
  const api = async (path, { method = 'GET', data, file, key, headers = {} } = {}) => {
    const h = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...headers };
    if (key) h['Idempotency-Key'] = key;
    let payload;
    if (file) { payload = new FormData(); payload.append('file', new Blob([file.bytes ?? '%PDF-1.4 synthetic chat invoice'], { type: 'application/pdf' }), 'demo.pdf'); }
    else if (data !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(data); }
    const r = await worker.fetch(new Request(origin + '/api/v1' + path, { method, headers: h, body: payload }), env);
    return { status: r.status, ...(r.status === 204 ? {} : await r.json()), headers: r.headers };
  };
  const login = async (user = 'owner@oli-demo.invalid') => {
    const r = await api('/session', { method: 'POST', data: { email: user, password: env.DEMO_PASSWORD } });
    assert.equal(r.status, 200); cookie = r.headers.get('Set-Cookie').split(';')[0]; csrf = r.data.csrfToken; session = r.data; return session;
  };
  await login();
  const invoice = async (overrides = {}, warnings = []) => {
    const uploaded = await api('/invoices', { method: 'POST', file: { bytes: '%PDF-1.4 synthetic ' + crypto.randomUUID() }, key: crypto.randomUUID() });
    assert.equal(uploaded.status, 201);
    const ex = { vendorName: vendor.name, invoiceNumber: 'CHAT-' + crypto.randomUUID(), amountMinor: 8900, currency: 'USD',
      issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10', description: 'Internet ficticio', extractionWarnings: warnings, evidence: [], ...overrides };
    const result = await processInvoice(env, 'org_demo', uploaded.data.id, async (_env, _file, _bytes, documentSha256) => ({
      extraction: ex, documentType: 'INVOICE', documentSha256, primaryReadId: 'read-' + crypto.randomUUID(),
      corroboration: corroboratePdfText(`Proveedor: ${ex.vendorName}\nMoneda: ${ex.currency}\nVencimiento: ${ex.dueDate}\nTotal: ${ex.currency} ${(ex.amountMinor / 100).toFixed(2)}`, documentSha256),
      provenance: { model: 'test-only' } }));
    return result.data;
  };
  const prepare = proposal => api('/chat/actions', { method: 'POST', data: proposal, key: crypto.randomUUID() });
  const confirm = (action, key = crypto.randomUUID()) => api(`/chat/actions/${action.id}/confirm`, { method: 'POST', data: { confirmed: true }, key });
  const onboard = i => ({ kind: 'ONBOARD_INVOICE_VENDOR', invoiceId: i.id, expectedDecisionId: i.latestDecision.id, vendor, agreement });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  const model = (...responses) => { globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const payload = JSON.parse(init.body); assert.equal(payload.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(init.headers.Authorization, 'Bearer test-provider-key'); calls.push(payload);
    const response = responses.shift(); assert.ok(response, 'unexpected additional provider request');
    return typeof response === 'function' ? response(payload) : Response.json({ choices: [response] });
  }; };
  const text = content => ({ finish_reason: 'stop', message: { content } });
  const tool = (name, args) => ({ finish_reason: 'tool_calls', message: { content: null,
    tool_calls: [{ id: 'call-' + crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
  const chat = (message, key = crypto.randomUUID(), conversationId = null, invoiceIds = []) => api('/chat/messages', { method: 'POST', key,
    data: { conversationId, text: message, invoiceIds } });
  return { env, DB, api, login, invoice, prepare, confirm, onboard, model, text, tool, chat, calls, get session() { return session; } };
}

test('chat usa herramientas reales, persiste historial y replay no vuelve a gastar', async t => {
  const h = await setup(t); h.model(h.tool('get_budget', { period: 'CURRENT_MONTH' }), h.text('Consulta el presupuesto registrado en la tarjeta.'));
  const key = crypto.randomUUID(); const r = await h.chat('¿Cómo va mi presupuesto?', key);
  assert.equal(r.status, 200, JSON.stringify(r)); ChatReplySchema.parse(r.data);
  assert.equal(r.data.cards[0].type, 'BUDGET'); assert.equal(h.calls.length, 2);
  assert.deepEqual((await h.chat('¿Cómo va mi presupuesto?', key)).data, r.data); assert.equal(h.calls.length, 2);
  assert.equal((await h.chat('otro mensaje', key)).status, 409);
  const history = await h.api('/chat/conversations/' + r.data.conversationId);
  assert.equal(history.data.turns.length, 1); assert.equal(history.data.turns[0].state, 'COMPLETED');
  assert.equal(JSON.stringify(r).includes('test-provider-key'), false);
  const usage = await h.api('/ai/usage');
  assert.equal(usage.status, 200); assert.equal(usage.data.calls, 2); assert.equal(usage.data.unreportedCalls, 2);
});

test('usage retains all chat rounds, failed output and Telegram tokens without spending on replay', async t => {
  const h = await setup(t);
  const response = choice => () => Response.json({ choices: [choice], usage: {
    prompt_tokens: 80, completion_tokens: 20, total_tokens: 100,
  } });
  h.model(response(h.tool('list_vendors', {})), response(h.text('Listado disponible.')));
  const key = crypto.randomUUID();
  const first = await h.chat('Listar proveedores', key); assert.equal(first.status, 200);
  await h.chat('Listar proveedores', key);
  assert.equal((await h.api('/ai/usage')).data.totalTokens, 200);
  h.model(response({ finish_reason: 'length', message: { content: 'Incomplete' } }));
  assert.equal((await h.chat('Respuesta incompleta')).status, 502);
  h.model(response(h.text('Hola desde Telegram.')));
  const request = new Request(origin + '/api/v1/chat/messages', { method: 'POST', headers: {
    'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json',
  }, body: JSON.stringify({ conversationId: null, text: 'Hola', invoiceIds: [] }) });
  assert.equal((await chatMessage(request, h.env, h.session, 'telegram')).status, 200);
  const usage = (await h.api('/ai/usage')).data;
  assert.equal(usage.totalTokens, 400); assert.equal(usage.calls, 4); assert.equal(usage.unreportedCalls, 0);
  const anonymous = await worker.fetch(new Request(origin + '/api/v1/ai/usage'), h.env);
  assert.equal(anonymous.status, 401);
});

test('Web y Telegram filtran historial y contexto, y rechazan cruce de canal incluso con replay cacheado', async t => {
  const h = await setup(t), tgKey = crypto.randomUUID();
  const tgInput = { conversationId: null, text: 'TG_ONLY', invoiceIds: [] };
  const internal = (input, key) => new Request(origin + '/api/v1/chat/messages', { method: 'POST',
    headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  h.model(h.text('Respuesta de Telegram'));
  const tg = (await (await chatMessage(internal(tgInput, tgKey), h.env, h.session, 'telegram')).json()).data;
  h.model(payload => {
    assert.equal(payload.messages.some(m => m.content?.includes('TG_ONLY')), false);
    return Response.json({ choices: [h.text('Respuesta web')] });
  });
  const web = await h.chat('WEB_ONLY'); assert.equal(web.status, 200);
  const webList = await h.api('/chat/conversations'), tgList = await h.api('/chat/conversations?channel=TELEGRAM');
  assert.deepEqual(webList.data.map(c => [c.id,c.channel]), [[web.data.conversationId,'WEB']]);
  assert.deepEqual(tgList.data.map(c => [c.id,c.channel]), [[tg.conversationId,'TELEGRAM']]);
  assert.equal((await h.api('/chat/conversations?channel=INVALID')).status, 400);
  assert.equal((await h.api('/chat/conversations/' + tg.conversationId)).data.channel, 'TELEGRAM');
  const calls = h.calls.length;
  assert.equal((await h.chat('cruce', crypto.randomUUID(), tg.conversationId)).status, 409);
  assert.equal((await h.chat('TG_ONLY', tgKey)).status, 409, 'un replay sin conversationId tampoco cruza canales');
  await assert.rejects(chatMessage(internal({ conversationId: web.data.conversationId, text: 'cruce', invoiceIds: [] }, crypto.randomUUID()), h.env, h.session, 'telegram'), e => e.code === 'CHAT_CHANNEL_MISMATCH');
  assert.equal(h.calls.length, calls);
  h.model(payload => {
    assert.equal(payload.messages.some(m => m.content?.includes('WEB_ONLY')), false);
    assert.ok(payload.messages.some(m => m.content === 'TG_ONLY'));
    return Response.json({ choices: [h.text('Seguimos en Telegram')] });
  });
  await chatMessage(internal({ ...tgInput, conversationId: tg.conversationId, text: 'sigue TG' }, crypto.randomUUID()), h.env, h.session, 'telegram');
  assert.equal((await h.api('/chat/conversations/' + web.data.conversationId)).data.turns.length, 1);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
});

test('el modelo solo propone: alta/modificación requieren confirmación, payload fijo e idempotencia', async t => {
  const h = await setup(t); const proposal = { kind: 'CREATE_VENDOR', data: vendor };
  h.model(h.tool('prepare_change', { proposal }), h.text('Revisa la propuesta antes de confirmar.'));
  const reply = await h.chat('Agrega Faro Telecom Demo como permitido.');
  assert.equal(reply.status, 200, JSON.stringify(reply)); const action = reply.data.actions[0];
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM vendors WHERE name = ?').bind(vendor.name).first('n'), 0);
  const forged = await h.api(`/chat/actions/${action.id}/confirm`, { method: 'POST', key: crypto.randomUUID(), data: { confirmed: true, data: { allowed: false } } }); assert.equal(forged.status, 400);
  const key = crypto.randomUUID(); const result = await h.confirm(action, key);
  assert.equal(result.status, 200, JSON.stringify(result)); ChatActionResultSchema.parse(result.data);
  assert.deepEqual((await h.confirm(action, key)).data, result.data);
  assert.deepEqual((await h.confirm(action)).data, result.data);
  const changed = await h.prepare({ kind: 'UPDATE_VENDOR', targetId: result.data.vendor.id, data: { allowed: false } });
  assert.equal(changed.data.before.allowed, true);
  assert.equal((await h.confirm(changed.data)).data.vendor.allowed, false);
});

test('trece proveedores usan una propuesta, confirmación atómica y replay sin duplicados', async t => {
  const h = await setup(t);
  const vendors = Array.from({ length: 13 }, (_, i) => ({ name: `Proveedor lote ${i}`, allowed: i !== 12, externalRef: null }));
  const proposal = { kind: 'CREATE_VENDORS', vendors };
  const baseline = await h.DB.prepare('SELECT count(*) n FROM vendors').first('n');
  h.model(h.tool('list_vendors', {}), h.tool('prepare_change', { proposal }), h.text('Revisa los trece proveedores y confirma el lote.'));
  const reply = await h.chat('Agrega estos trece proveedores con los permisos indicados.');
  assert.equal(reply.status, 200, JSON.stringify(reply));
  assert.equal(reply.data.actions.length, 1);
  assert.equal(reply.data.actions[0].proposal.vendors.length, 13);
  assert.equal(h.calls.length, 3);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors').first('n'), baseline);
  const action = reply.data.actions[0], key = crypto.randomUUID();
  const forged = await h.api(`/chat/actions/${action.id}/confirm`, { method: 'POST', key: crypto.randomUUID(), data: { confirmed: true, vendors: [] } });
  assert.equal(forged.status, 400);
  const result = await h.confirm(action, key);
  assert.equal(result.status, 200, JSON.stringify(result));
  ChatActionResultSchema.parse(result.data);
  assert.deepEqual(result.data.vendors.map(({ name, allowed, externalRef }) => ({ name, allowed, externalRef })), vendors);
  assert.equal(result.data.vendor, null);
  assert.deepEqual((await h.confirm(action, key)).data, result.data);
  assert.deepEqual((await h.confirm(action)).data, result.data);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors').first('n'), baseline + 13);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
  assert.equal(await h.DB.prepare("SELECT count(*) n FROM audit_events WHERE type='CHAT_ACTION_CONFIRMED' AND entity_id=?").bind(action.id).first('n'), 1);
});

test('lotes rechazan nombres repetidos/existentes, datos inválidos y roles sin permiso', async t => {
  const h = await setup(t);
  const proposal = { kind: 'CREATE_VENDORS', vendors: [vendor] };
  const baseline = await h.DB.prepare('SELECT count(*) n FROM vendors').first('n');
  const duplicate = await h.prepare({ ...proposal, vendors: [vendor, { ...vendor, name: '  FARO   TELECOM DEMO ' }] });
  assert.equal(duplicate.status, 409);
  const blocked = await h.DB.prepare('SELECT name FROM vendors WHERE allowed=0 LIMIT 1').first('name');
  assert.equal((await h.prepare({ ...proposal, vendors: [vendor, { ...vendor, name: blocked }] })).status, 409);
  assert.equal(await h.DB.prepare('SELECT allowed FROM vendors WHERE name=?').bind(blocked).first('allowed'), 0);
  for (const vendors of [[], Array(21).fill(vendor), [{ ...vendor, allowed: undefined }]]) {
    assert.equal((await h.prepare({ ...proposal, vendors })).status, 400);
  }
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors').first('n'), baseline);
  h.env.DEMO_USER_ID = 'user_demo_approver'; await h.login('approver@oli-demo.invalid');
  assert.equal((await h.prepare(proposal)).status, 403);
});

test('cancelación y cambio concurrente impiden cualquier alta del lote', async t => {
  const h = await setup(t), proposal = { kind: 'CREATE_VENDORS', vendors: [vendor, { ...vendor, name: 'Segundo lote Demo' }] };
  const cancelled = await h.prepare(proposal);
  await h.api(`/chat/actions/${cancelled.data.id}/cancel`, { method: 'POST' });
  assert.equal((await h.confirm(cancelled.data)).status, 409);
  const stale = await h.prepare(proposal);
  await h.DB.prepare("UPDATE organizations SET state_revision=state_revision+1 WHERE id='org_demo'").run();
  assert.equal((await h.confirm(stale.data)).error.code, 'ACTION_STALE');
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors WHERE name=?').bind(vendor.name).first('n'), 0);
});

test('un fallo al insertar el segundo proveedor revierte el lote y su confirmación', async t => {
  const h = await setup(t), name = 'Fallo deliberado del lote';
  const prepared = await h.prepare({ kind: 'CREATE_VENDORS', vendors: [vendor, { ...vendor, name }] });
  await h.DB.prepare("CREATE TRIGGER reject_batch_test BEFORE INSERT ON vendors WHEN NEW.name='Fallo deliberado del lote' BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: forced_batch_failure'); END").run();
  const result = await h.confirm(prepared.data);
  assert.equal(result.status, 409);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors WHERE name IN (?,?)').bind(vendor.name, name).first('n'), 0);
  assert.equal((await h.api('/chat/actions/' + prepared.data.id)).data.status, 'PENDING');
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
});

test('límite de herramientas explica causa y siguiente paso sin publicar propuestas parciales', async t => {
  const h = await setup(t);
  const proposal = { kind: 'CREATE_VENDOR', data: vendor };
  const tooMany = h.tool('list_vendors', {});
  tooMany.message.tool_calls = Array.from({ length: 4 }, () => h.tool('list_vendors', {}).message.tool_calls[0]);
  h.model(h.tool('prepare_change', { proposal }), tooMany);
  const result = await h.chat('Una solicitud con demasiadas acciones');
  assert.equal(result.error.code, 'CHAT_TOOL_LIMIT');
  assert.match(result.error.message, /máximo de 4/);
  assert.match(result.error.message, /lote de hasta 20/);
  assert.match(result.error.message, /No se ejecutó ningún cambio/);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM chat_actions').first('n'), 0);
});

test('límite de rondas explica que faltó terminar sin crear proveedores', async t => {
  const h = await setup(t);
  h.model(h.tool('prepare_change', { proposal: { kind: 'CREATE_VENDOR', data: vendor } }), h.tool('list_vendors', {}), h.tool('list_vendors', {}));
  const result = await h.chat('Otra solicitud que no logra terminar');
  assert.equal(result.error.code, 'CHAT_TOOL_LIMIT');
  assert.match(result.error.message, /máximo de 3 rondas/);
  assert.match(result.error.message, /Divide la solicitud/);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM chat_actions').first('n'), 0);
  assert.equal(await h.DB.prepare('SELECT count(*) n FROM vendors WHERE name=?').bind(vendor.name).first('n'), 0);
});

test('proveedor desconocido: confirma proveedor/acuerdo, reevalúa misma factura y conserva decisión/reserva única', async t => {
  const h = await setup(t), i = await h.invoice();
  assert.equal(i.latestDecision.action, 'BLOCK'); assert.ok(i.latestDecision.reasons.includes('UNKNOWN_VENDOR'));
  const intake = await h.api(`/invoices/${i.id}/intake`); assert.equal(intake.data.intake.canOnboard, true);
  const prepared = await h.prepare(h.onboard(i)); assert.equal(prepared.status, 201, JSON.stringify(prepared));
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM invoice_vendor_resolutions').first('n'), 0);
  const key = crypto.randomUUID(), result = await h.confirm(prepared.data, key);
  assert.equal(result.status, 200, JSON.stringify(result)); const after = result.data.invoice;
  assert.equal(after.id, i.id); assert.equal(after.latestDecision.action, 'APPROVE'); assert.equal(after.decisions.length, 2);
  assert.deepEqual(after.decisions[0], i.decisions[0]); assert.equal(after.amountMinor, 8900);
  assert.deepEqual((await h.confirm(prepared.data, key)).data, result.data);
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 1);
  assert.equal(await h.DB.prepare('SELECT sum(reserved_minor) AS n FROM budget_periods').first('n'), 8900);
  const persisted = (await h.api(`/invoices/${i.id}`)).data; assert.deepEqual(persisted, after);
  await assert.rejects(h.DB.prepare('UPDATE invoices SET amount_minor = 1 WHERE id = ?').bind(i.id).run(), /IMMUTABLE/);
  await assert.rejects(h.DB.prepare('UPDATE invoices SET vendor_id = vendor_id WHERE id = ?').bind(i.id).run(), /IMMUTABLE/);
  await assert.rejects(h.DB.prepare('DELETE FROM invoice_vendor_resolutions').run(), /IMMUTABLE/);
});

test('el alta respeta límites y permite revisión humana usando el ID persistido', async t => {
  const h = await setup(t), i = await h.invoice({ amountMinor: 45000 });
  const p = h.onboard(i); p.agreement = { ...agreement, amountMinor: 45000 };
  const action = await h.prepare(p); const result = await h.confirm(action.data);
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.invoice.latestDecision.action, 'ESCALATE');
  assert.equal(result.data.invoice.approvalRequest.canApprove, true);
  const stored = (await h.api('/invoices/' + i.id)).data;
  assert.deepEqual(result.data.invoice, stored);
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 0);
});

test('no ofrece alta para lectura incierta, nombre alterado, proveedor prohibido ni acuerdo inventado incompleto', async t => {
  const h = await setup(t), unclear = await h.invoice({}, ['Total ambiguo']);
  assert.equal((await h.api('/invoices/' + unclear.id + '/intake')).data.intake.canOnboard, false);
  assert.equal((await h.prepare(h.onboard(unclear))).status, 409);
  const i = await h.invoice({ amountMinor: 9000 }); const p = h.onboard(i); p.vendor = { ...vendor, name: 'Otro proveedor' };
  assert.equal((await h.prepare(p)).status, 400);
  assert.equal((await h.prepare({ ...h.onboard(i), agreement: null })).error.code, 'AGREEMENT_REQUIRED');
  // Use the actual blocked seed name, independent of presentation labels.
  const blockedName = await h.DB.prepare('SELECT name FROM vendors WHERE allowed = 0 LIMIT 1').first('name');
  const blocked = await h.invoice({ vendorName: blockedName });
  assert.equal((await h.api('/invoices/' + blocked.id + '/intake')).data.intake.status, 'DISALLOWED_VENDOR');
  assert.equal((await h.prepare({ ...h.onboard(blocked), vendor: { ...vendor, name: blockedName } })).status, 409);
});

test('si el proveedor fue registrado aparte, retoma la factura por coincidencia exacta sin crearlo otra vez', async t => {
  const h = await setup(t), i = await h.invoice();
  const v = await h.confirm((await h.prepare({ kind: 'CREATE_VENDOR', data: vendor })).data);
  await h.confirm((await h.prepare({ kind: 'CREATE_AGREEMENT', data: { ...agreement, vendorId: v.data.vendor.id } })).data);
  const intake = (await h.api('/invoices/' + i.id + '/intake')).data.intake;
  assert.equal(intake.canOnboard, false); assert.equal(intake.canResume, true);
  const action = await h.prepare({ kind: 'RESUME_INVOICE', invoiceId: i.id, expectedDecisionId: i.latestDecision.id });
  const result = await h.confirm(action.data); assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.data.invoice.latestDecision.action, 'APPROVE');
});

test('propuestas obsoletas, canceladas o vencidas no mutan; confirmaciones concurrentes crean una sola alta', async t => {
  const h = await setup(t), stale = await h.prepare({ kind: 'CREATE_VENDOR', data: vendor });
  await h.DB.prepare('UPDATE organizations SET state_revision = state_revision + 1').run();
  assert.equal((await h.confirm(stale.data)).error.code, 'ACTION_STALE');
  const cancel = await h.prepare({ kind: 'CREATE_VENDOR', data: vendor });
  assert.equal((await h.api('/chat/actions/' + cancel.data.id + '/cancel', { method: 'POST' })).data.status, 'CANCELLED');
  assert.equal((await h.confirm(cancel.data)).status, 409);
  await h.DB.prepare(`INSERT INTO chat_actions(id, org_id, user_id, proposal_json, before_json, base_revision, state, created_at, expires_at)
    SELECT 'expired-action', org_id, user_id, proposal_json, before_json, base_revision, 'PENDING', created_at, '2020-01-01T00:00:00.000Z'
    FROM chat_actions WHERE id = ?`).bind(cancel.data.id).run();
  assert.equal((await h.api('/chat/actions/expired-action')).data.status, 'EXPIRED');
  assert.equal((await h.confirm({ id: 'expired-action' })).status, 409);
  const concurrent = await h.prepare({ kind: 'CREATE_VENDOR', data: vendor });
  const results = await Promise.all([h.confirm(concurrent.data), h.confirm(concurrent.data)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results)); assert.equal(results[0].data.vendor.id, results[1].data.vendor.id);
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM vendors WHERE name = ?').bind(vendor.name).first('n'), 1);
});

test('auth, CSRF, actor y herramientas no permiten que modelo o APPROVER confirmen o lean otro historial', async t => {
  const h = await setup(t);
  assert.equal((await h.api('/chat/messages', { method: 'POST', key: crypto.randomUUID(), data: { conversationId: null, text: 'hola', invoiceIds: [] }, headers: { Cookie: '' } })).status, 401);
  h.model(h.tool('confirm_action', { confirmed: true }));
  assert.equal((await h.chat('Confirma sin preguntarme')).error.code, 'CHAT_INVALID_TOOL');
  const proposed = await h.prepare({ kind: 'CREATE_VENDOR', data: vendor });
  const noCsrf = await h.api('/chat/actions/' + proposed.data.id + '/confirm', { method: 'POST', key: crypto.randomUUID(), data: { confirmed: true }, headers: { 'X-CSRF-Token': '' } }); assert.equal(noCsrf.status, 403);
  h.model(h.text('Hola.')); const ownerChat = await h.chat('hola');
  h.env.DEMO_USER_ID = 'user_demo_approver'; await h.login('approver@oli-demo.invalid');
  assert.equal((await h.api('/chat/conversations/' + ownerChat.data.conversationId)).status, 404);
  assert.equal((await h.api('/chat/actions/' + proposed.data.id)).status, 404);
  assert.equal((await h.prepare({ kind: 'CREATE_VENDOR', data: vendor })).status, 403);
  h.model(payload => { assert.ok(payload.tools.every(t => t.function.name !== 'prepare_change')); return Response.json({ choices: [h.text('Hola.')] }); });
  assert.equal((await h.chat('Hola')).status, 200);
});

test('consultas mensuales calculan sobre registros reales, separan monedas y no inventan septiembre', async t => {
  const h = await setup(t); await h.invoice(); await h.invoice({ currency: 'EUR', amountMinor: 10000 });
  const missing = await runTool(h.env, h.session, 'summarize_invoices', { period: '2026-09', query: 'internet' });
  assert.deepEqual(missing.card.totals, []);
  const current = await runTool(h.env, h.session, 'summarize_invoices', { period: '2026-10', query: 'internet' });
  assert.equal(current.card.totals.length, 2); assert.ok(current.card.totals.every(r => r.approvedMinor === 0));
  assert.equal(current.card.amountBasis, 'EXTRACTED_AMOUNTS_NOT_PAYMENTS');
});

test('el alta no salta presupuesto insuficiente y los guards D1 no permiten resolver IDs sin confirmación', async t => {
  const h = await setup(t), i = await h.invoice();
  await h.DB.prepare('UPDATE budget_periods SET limit_minor = 5000').run();
  const action = await h.prepare(h.onboard(i)); assert.equal(action.status, 201, JSON.stringify(action));
  await assert.rejects(h.DB.prepare(`INSERT INTO invoice_vendor_resolutions(org_id,invoice_id,previous_decision_id,vendor_id,agreement_id,action_id,user_id,created_at)
    VALUES ('org_demo', ?, ?, 'vendor_demo_cloud', 'agr_demo_cloud', ?, 'user_demo_owner', ?)`).bind(i.id, i.latestDecision.id, action.data.id, new Date().toISOString()).run(), /INVALID_INVOICE_RESOLUTION/);
  await assert.rejects(h.DB.prepare("UPDATE invoices SET vendor_id = 'vendor_demo_cloud' WHERE id = ?").bind(i.id).run(), /IMMUTABLE/);
  const result = await h.confirm(action.data); assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.invoice.latestDecision.action, 'BLOCK');
  assert.ok(result.data.invoice.latestDecision.reasons.includes('BUDGET_EXCEEDED'));
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 0);
});

test('fallo de proveedor no publica propuestas y reintentos de un turno están acotados', async t => {
  const h = await setup(t); const proposal = { kind: 'CREATE_VENDOR', data: vendor };
  h.model(h.tool('prepare_change', { proposal }), () => Response.json({ error: 'provider failed' }, { status: 503 }));
  const key = crypto.randomUUID(); const first = await h.chat('Agrega este proveedor', key);
  assert.equal(first.status, 502); assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM chat_actions').first('n'), 0);
  for (let i = 0; i < 2; i++) { h.model(() => Response.json({}, { status: 503 })); assert.equal((await h.chat('Agrega este proveedor', key)).status, 502); }
  assert.equal((await h.chat('Agrega este proveedor', key)).error.code, 'CHAT_RETRY_LIMIT');
  assert.equal(await h.DB.prepare('SELECT count(*) AS n FROM vendors WHERE name = ?').bind(vendor.name).first('n'), 0);
});

test('dos requests del mismo turno no duplican llamadas al modelo; adjuntos ajenos se rechazan antes', async t => {
  const h = await setup(t);
  assert.equal((await h.chat('', crypto.randomUUID(), null, ['other-invoice'])).status, 404); assert.equal(h.calls.length, 0);
  let release; const pending = new Promise(r => { release = r; });
  let arrived; const started = new Promise(r => { arrived = r; });
  h.model(async () => { arrived(); await pending; return Response.json({ choices: [h.text('Hola.')] }); });
  const key = crypto.randomUUID(), first = h.chat('Hola', key);
  await started;
  const second = await h.chat('Hola', key); assert.equal(second.error.code, 'CHAT_IN_PROGRESS'); assert.equal(h.calls.length, 1);
  release(); assert.equal((await first).status, 200);
});

test('diez facturas adjuntas y cuatro consultas caben en la respuesta; once se rechazan antes del modelo', async t => {
  const h = await setup(t), invoiceIds = [];
  for (let n = 0; n < 10; n++) invoiceIds.push((await h.invoice()).id);
  const queries = Array.from({ length: 4 }, () => h.tool('get_budget', { period: 'CURRENT_MONTH' }).message.tool_calls[0]);
  h.model({ finish_reason: 'tool_calls', message: { content: null, tool_calls: queries } }, h.text('Recibí las diez facturas y consulté el presupuesto.'));
  const result = await h.chat('Revisa estas diez facturas', crypto.randomUUID(), null, invoiceIds);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.cards.length, 14);
  assert.equal(result.data.cards.filter(card => card.type === 'INVOICE').length, 10);
  assert.equal(h.calls.length, 2);
  const excessive = await h.chat('Demasiadas facturas', crypto.randomUUID(), null, [...invoiceIds, invoiceIds[0]]);
  assert.equal(excessive.status, 400); assert.equal(h.calls.length, 2);
});

test('el recibo de diez adjuntos pendientes no promete seguimiento ni gasta modelo y el intake refleja la decisión posterior', async t => {
  const h = await setup(t), invoiceIds = [];
  h.model(); // Any provider call would fail this test.
  for (let n = 0; n < 10; n++) {
    const uploaded = await h.api('/invoices', { method: 'POST', file: { bytes: '%PDF-1.4 pending ' + crypto.randomUUID() }, key: crypto.randomUUID() });
    assert.equal(uploaded.status, 201);
    invoiceIds.push(uploaded.data.id);
  }
  const key = crypto.randomUUID();
  const result = await h.chat('', key, null, invoiceIds);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.cards.length, 10);
  assert.ok(result.data.cards.every(card => card.intake.status === 'PROCESSING'));
  assert.match(result.data.text, /tarjetas/);
  assert.doesNotMatch(result.data.text, /te avis|las reviso|volveré/);
  assert.deepEqual((await h.chat('', key, null, invoiceIds)).data, result.data);
  assert.equal(h.calls.length, 0);
  const processed = await processInvoice(h.env, 'org_demo', invoiceIds[0], async (_env, _file, _bytes, documentSha256) => ({
    extraction: { vendorName: vendor.name, invoiceNumber: 'RECEIPT-TEST', amountMinor: 8900, currency: 'USD',
      issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10', description: 'Internet ficticio', extractionWarnings: [], evidence: [] },
    documentType: 'INVOICE', documentSha256, primaryReadId: 'receipt-read',
    corroboration: corroboratePdfText(`Proveedor: ${vendor.name}\nMoneda: USD\nVencimiento: 2026-10-31\nTotal: USD 89.00`, documentSha256),
  }));
  assert.equal(processed.data.status, 'DECIDED');
  const intake = await h.api(`/invoices/${invoiceIds[0]}/intake`);
  assert.equal(intake.data.invoice.status, 'DECIDED');
  assert.notEqual(intake.data.intake.status, 'PROCESSING');
  const history = await h.api('/chat/conversations/' + result.data.conversationId);
  assert.equal(history.data.turns[0].reply.cards[0].intake.status, 'PROCESSING');
});

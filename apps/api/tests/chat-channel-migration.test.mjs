import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { chatHistory, chatMessage } from '../worker/chat.js';

test('migración separa hilo antiguo mixto conservando mensajes, snapshots y orden; el modelo web no recibe Telegram', async t => {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'legacy-chat' } });
  t.after(() => runtime.dispose()); const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const apply = async path => DB.batch(readFileSync(new URL(path, root), 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  for (const name of readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql') && !f.startsWith('0009')).sort()) await apply('migrations/' + name);
  await apply('seed/demo.sql');
  const stamp = '2026-10-17T12:00:00.000Z', originalId = 'chat_legacy_tg', recovered = 'chat_web_legacy_' + originalId;
  await DB.batch([
    DB.prepare("INSERT INTO telegram_connections(id,org_id,user_id,telegram_user_id,chat_id,display_name,connected_at) VALUES ('tg_legacy','org_demo','user_demo_owner','101','101','Oscar',?)").bind(stamp),
    DB.prepare("INSERT INTO chat_conversations(id,org_id,user_id,created_at,updated_at) VALUES (?,'org_demo','user_demo_owner',?,?)").bind(originalId, stamp, stamp),
    DB.prepare("INSERT INTO telegram_conversations(connection_id,org_id,user_id,conversation_id) VALUES ('tg_legacy','org_demo','user_demo_owner',?)").bind(originalId),
  ]);
  const originals = [];
  for (const [id, text, channel] of [['turn_z','WEB_LEGACY_FIRST','web'],['turn_tg','TG_LEGACY_ONLY','telegram'],['turn_a','WEB_LEGACY_SECOND','web']]) {
    const reply = JSON.stringify({ data: { conversationId: originalId, turnId: id, text: 'Respuesta ' + text,
      cards: [], actions: [], model: 'deepseek/deepseek-v4.1-flash', createdAt: stamp } });
    await DB.batch([
      DB.prepare(`INSERT INTO chat_turns(id,org_id,user_id,conversation_id,client_key,request_hash,user_text,invoice_ids_json,state,started_at,response_json,created_at)
        VALUES (?,'org_demo','user_demo_owner',?,?,? ,?,'[]','COMPLETED',?,?,?)`).bind(id,originalId,crypto.randomUUID(),'hash',text,stamp,reply,stamp),
      DB.prepare("INSERT INTO audit_events(id,org_id,actor_kind,actor_id,type,entity_id,details_json,created_at) VALUES (?,'org_demo','HUMAN','user_demo_owner','CHAT_TURN_COMPLETED',?,?,?)").bind('evt_'+id,id,JSON.stringify({channel}),stamp),
    ]);
    originals.push({ id, reply });
  }
  await apply('migrations/0009_chat_channels.sql');
  const session = { user: { id: 'user_demo_owner' }, organization: { id: 'org_demo', name: 'Demo', timezone: 'America/Caracas' }, role: 'OWNER' };
  const env = { DB, OPENROUTER_API_KEY: 'test-only' };
  const tg = (await (await chatHistory(env,session,originalId)).json()).data;
  const web = (await (await chatHistory(env,session,recovered)).json()).data;
  assert.deepEqual(tg.turns.map(r => r.text), ['TG_LEGACY_ONLY']);
  assert.deepEqual(web.turns.map(r => r.text), ['WEB_LEGACY_FIRST','WEB_LEGACY_SECOND']);
  assert.equal(tg.channel, 'TELEGRAM'); assert.equal(web.channel, 'WEB');
  for (const old of originals) {
    const row = await DB.prepare('SELECT conversation_id,response_json FROM chat_turns WHERE id = ?').bind(old.id).first();
    assert.equal(row.conversation_id, originalId); assert.equal(row.response_json, old.reply);
  }
  await assert.rejects(DB.prepare("UPDATE chat_turn_placements SET conversation_id = ?").bind(originalId).run(), /IMMUTABLE/);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const messages = JSON.parse(init.body).messages;
    assert.equal(messages.some(m => m.content?.includes('TG_LEGACY_ONLY')), false);
    assert.ok(messages.some(m => m.content === 'WEB_LEGACY_FIRST'));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Seguimos en Web.' } }] });
  });
  const request = new Request('https://oli.invalid/api/v1/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ conversationId: recovered, text: 'Continuar', invoiceIds: [] }) });
  assert.equal((await chatMessage(request,env,session)).status, 200);
  assert.equal((await (await chatHistory(env,session,originalId)).json()).data.turns.length, 1);
  assert.equal((await (await chatHistory(env,session,recovered)).json()).data.turns.length, 3);
});

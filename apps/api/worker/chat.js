import { ChatChannelSchema, ChatConversationsSchema, ChatHistorySchema, ChatMessageInputSchema, ChatReplySchema } from '@oli/contracts';
import { audit, body, clearGuard, HttpError, id, json, now, readBytes, sha256, stmt } from './http.js';
import { idempotency } from './repository.js';
import { actionInsert, inspectInvoice } from './chat-actions.js';
import { runTool, toolsFor } from './chat-tools.js';
import { chatPrompt, CHAT_PROMPT_VERSION } from './chat-prompt.js';

const MODEL = 'deepseek/deepseek-v4.1-flash';

function modelCard(card) {
  const invoice = i => ({ id: i.id, vendorName: i.vendorName, amountMinor: i.amountMinor, currency: i.currency,
    status: i.status, servicePeriod: i.servicePeriod, issuedAt: i.issuedAt,
    latestDecision: i.latestDecision ? { action: i.latestDecision.action, reasons: i.latestDecision.reasons, explanation: i.latestDecision.humanExplanation } : null });
  if (card.type === 'INVOICE') return { type: card.type, invoice: invoice(card.invoice), intake: card.intake };
  if (card.type === 'INVOICES') return { ...card, invoices: card.invoices.map(invoice) };
  return card;
}

export async function completeChat(env, session, history, input, channel = 'web') {
  if (!env.OPENROUTER_API_KEY) throw new HttpError(503, 'CHAT_UNAVAILABLE', 'La conversación no está configurada.');
  const cards = [], prepared = [], calls = [];
  for (const invoiceId of new Set(input.invoiceIds)) cards.push(await inspectInvoice(env, session, invoiceId));
  const messages = [{ role: 'system', content: chatPrompt(session, channel) }, ...history,
    { role: 'user', content: JSON.stringify({ message: input.text, attachedInvoices: cards.map(modelCard) }) }];
  const deadline = Date.now() + 35_000;
  let toolCount = 0;
  for (let round = 0; round < 3; round++) {
    const remaining = Math.min(20_000, deadline - Date.now());
    if (remaining < 500) throw new HttpError(504, 'CHAT_TIMEOUT');
    let payload;
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(remaining),
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, tools: toolsFor(session), tool_choice: 'auto',
          temperature: 0, max_tokens: 1500, stream: false, provider: { require_parameters: true } }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status === 429 ? 503 : 502, 'CHAT_PROVIDER_UNAVAILABLE'); }
      payload = JSON.parse(new TextDecoder().decode(await readBytes(response, 128 * 1024)));
    } catch (error) {
      if (error instanceof HttpError && error.code === 'FILE_TOO_LARGE') throw new HttpError(502, 'CHAT_INVALID_OUTPUT');
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'CHAT_PROVIDER_UNAVAILABLE', 'No pude completar la respuesta. Tus datos no se modificaron.');
    }
    const choice = payload.choices?.[0], msg = choice?.message;
    if (!msg || msg.refusal || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw new HttpError(502, 'CHAT_INVALID_OUTPUT');
    if (!msg.tool_calls?.length) {
      if (typeof msg.content !== 'string' || !msg.content.trim() || msg.content.length > 8000) throw new HttpError(502, 'CHAT_INVALID_OUTPUT');
      return { text: msg.content, cards, prepared, calls, rounds: round + 1 };
    }
    if (!Array.isArray(msg.tool_calls) || (toolCount += msg.tool_calls.length) > 4) throw new HttpError(502, 'CHAT_TOOL_LIMIT');
    messages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : null, tool_calls: msg.tool_calls });
    const usedIds = new Set();
    for (const call of msg.tool_calls) {
      if (typeof call.id !== 'string' || call.id.length > 100 || usedIds.has(call.id) || call.type !== 'function'
        || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string' || call.function.arguments.length > 16_000) throw new HttpError(502, 'CHAT_INVALID_TOOL');
      usedIds.add(call.id);
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { throw new HttpError(502, 'CHAT_INVALID_TOOL_ARGUMENTS'); }
      let result;
      try {
        const value = await runTool(env, session, call.function.name, args);
        if (value.card) cards.push(value.card);
        if (value.prepared) prepared.push(value.prepared);
        result = value.card ? modelCard(value.card) : { proposal: value.prepared.action, executed: false };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        result = { error: { code: error.code, message: error.message } };
      }
      calls.push(call.function.name);
      const content = JSON.stringify(result);
      if (content.length > 32_000) throw new HttpError(502, 'CHAT_TOOL_OUTPUT_LIMIT');
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  throw new HttpError(502, 'CHAT_TOOL_LIMIT');
}

async function conversation(env, session, conversationId, channel = null) {
  const row = await stmt(env.DB, 'SELECT * FROM chat_conversations WHERE org_id = ? AND user_id = ? AND id = ?', session.organization.id, session.user.id, conversationId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  if (channel && row.channel !== channel) throw new HttpError(409, 'CHAT_CHANNEL_MISMATCH', 'Esta conversación continúa en otro canal. Abre una conversación web para escribir aquí.');
  return row;
}
export async function chatHistory(env, session, conversationId) {
  const current = await conversation(env, session, conversationId);
  const rows = (await stmt(env.DB, 'SELECT * FROM chat_channel_turns WHERE org_id = ? AND user_id = ? AND history_conversation_id = ? AND channel = ? ORDER BY created_at DESC, history_order DESC LIMIT 20',
    session.organization.id, session.user.id, conversationId, current.channel).all()).results.reverse();
  // Replies are historical snapshots. Clients refresh pending action status through GET /chat/actions/:id.
  return json({ data: ChatHistorySchema.parse({ id: conversationId, channel: current.channel, turns: rows.map(r => ({ id: r.id, text: r.user_text,
    invoiceIds: JSON.parse(r.invoice_ids_json), state: r.state, reply: r.response_json ? JSON.parse(r.response_json).data : null,
    errorCode: r.error_code, createdAt: r.created_at })) }) });
}
export async function listConversations(env, session, request) {
  const parsed = ChatChannelSchema.safeParse(new URL(request.url).searchParams.get('channel') ?? 'WEB');
  if (!parsed.success) throw new HttpError(400, 'INVALID_CHANNEL');
  const rows = (await stmt(env.DB, `SELECT c.id,c.channel,c.created_at AS createdAt,c.updated_at AS updatedAt,
    (SELECT t.user_text FROM chat_channel_turns t WHERE t.org_id = c.org_id AND t.user_id = c.user_id
      AND t.history_conversation_id = c.id AND t.channel = c.channel ORDER BY t.created_at,t.history_order LIMIT 1) AS title
    FROM chat_conversations c WHERE c.org_id = ? AND c.user_id = ? AND c.channel = ? ORDER BY c.updated_at DESC,c.id DESC LIMIT 20`,
    session.organization.id, session.user.id, parsed.data).all()).results;
  for (const row of rows) row.title = Array.from(row.title ?? '').slice(0, 40).join('');
  return json({ data: ChatConversationsSchema.parse(rows) });
}

export async function chatMessage(request, env, session, channel = 'web') {
  const input = await body(request, ChatMessageInputSchema);
  const hash = await sha256(JSON.stringify(input));
  // Reuse the public UUID validation; turns persist the claim before any provider spend.
  const idem = await idempotency(request, env.DB, session, hash);
  const key = request.headers.get('Idempotency-Key'), org = session.organization.id, actor = session.user.id;
  let turn = await stmt(env.DB, 'SELECT * FROM chat_turns WHERE org_id = ? AND user_id = ? AND client_key = ?', org, actor, key).first();
  const source = channel === 'telegram' ? 'TELEGRAM' : 'WEB';
  if (input.conversationId) await conversation(env, session, input.conversationId, source);
  if (turn && turn.channel !== source) throw new HttpError(409, 'CHAT_CHANNEL_MISMATCH');
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  if (turn && turn.request_hash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
  if (turn?.state === 'COMPLETED') return json(JSON.parse(turn.response_json));
  if (turn?.state === 'PROCESSING' && turn.started_at > new Date(Date.now() - 90_000).toISOString()) throw new HttpError(409, 'CHAT_IN_PROGRESS');
  if (turn?.attempts >= 3) throw new HttpError(409, 'CHAT_RETRY_LIMIT');
  // Validate private attachments before saving a turn or making a model call.
  for (const invoiceId of new Set(input.invoiceIds)) await inspectInvoice(env, session, invoiceId);
  const count = await stmt(env.DB, 'SELECT coalesce(sum(attempts), 0) AS n FROM chat_turns WHERE org_id = ? AND user_id = ? AND created_at > ?', org, actor, new Date(Date.now() - 15 * 60_000).toISOString()).first('n');
  if (count >= 20) throw new HttpError(429, 'RATE_LIMITED', 'Espera unos minutos antes de continuar la conversación.');
  const conversationId = turn?.conversation_id ?? input.conversationId ?? id('chat');
  const token = id('lease'), time = now();
  try {
    const rateGuard = id('guard');
    const batch = [stmt(env.DB, 'INSERT INTO commit_guards(id, valid) VALUES (?, (SELECT coalesce(sum(attempts), 0) < 20 FROM chat_turns WHERE org_id = ? AND user_id = ? AND created_at > ?))', rateGuard, org, actor, new Date(Date.now() - 15 * 60_000).toISOString())];
    if (!turn && !input.conversationId) batch.push(stmt(env.DB, 'INSERT INTO chat_conversations(id, org_id, user_id, created_at, updated_at, channel) VALUES (?, ?, ?, ?, ?, ?)', conversationId, org, actor, time, time, source));
    batch.push(stmt(env.DB, "UPDATE chat_turns SET state = 'FAILED', lease_token = NULL, error_code = 'CHAT_INTERRUPTED' WHERE conversation_id = ? AND state = 'PROCESSING' AND started_at <= ?", conversationId, new Date(Date.now() - 90_000).toISOString()));
    if (turn) batch.push(stmt(env.DB, "UPDATE chat_turns SET state = 'PROCESSING', lease_token = ?, started_at = ?, error_code = NULL, attempts = attempts + 1 WHERE id = ? AND state = 'FAILED' AND attempts < 3", token, time, turn.id));
    else batch.push(stmt(env.DB, `INSERT INTO chat_turns(id, org_id, user_id, conversation_id, client_key, request_hash,
      user_text, invoice_ids_json, state, lease_token, started_at, created_at, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, ?, ?)`,
      id('turn'), org, actor, conversationId, key, hash, input.text, JSON.stringify(input.invoiceIds), token, time, time, source));
    batch.push(clearGuard(env.DB, rateGuard));
    await env.DB.batch(batch);
  } catch (error) {
    if (/UNIQUE constraint/.test(String(error))) throw new HttpError(409, 'CHAT_IN_PROGRESS');
    if (/CHECK constraint/.test(String(error))) throw new HttpError(429, 'RATE_LIMITED');
    throw error;
  }
  turn = await stmt(env.DB, 'SELECT * FROM chat_turns WHERE org_id = ? AND user_id = ? AND client_key = ?', org, actor, key).first();
  if (turn.lease_token !== token) throw new HttpError(409, 'CHAT_IN_PROGRESS');
  try {
    const previous = (await stmt(env.DB, "SELECT user_text, response_json FROM chat_channel_turns WHERE org_id = ? AND user_id = ? AND history_conversation_id = ? AND channel = ? AND state = 'COMPLETED' ORDER BY created_at DESC, history_order DESC LIMIT 6", org, actor, conversationId, source).all()).results.reverse();
    const history = previous.flatMap(r => [{ role: 'user', content: r.user_text }, { role: 'assistant', content: JSON.parse(r.response_json).data.text }]);
    const result = await completeChat(env, session, history, input, channel);
    const response = { data: ChatReplySchema.parse({ conversationId, turnId: turn.id, text: result.text,
      cards: result.cards, actions: result.prepared.map(p => p.action), createdAt: now(), model: MODEL }) };
    if (JSON.stringify(response).length > 256_000) throw new HttpError(502, 'CHAT_TOOL_OUTPUT_LIMIT');
    const guardId = id('guard');
    await env.DB.batch([
      stmt(env.DB, "INSERT INTO commit_guards(id, valid) VALUES (?, EXISTS(SELECT 1 FROM chat_turns WHERE id = ? AND state = 'PROCESSING' AND lease_token = ?))", guardId, turn.id, token),
      ...result.prepared.map(p => actionInsert(env.DB, session, p)),
      stmt(env.DB, "UPDATE chat_turns SET state = 'COMPLETED', response_json = ?, lease_token = NULL WHERE id = ?", JSON.stringify(response), turn.id),
      stmt(env.DB, 'UPDATE chat_conversations SET updated_at = ? WHERE id = ?', now(), conversationId),
      audit(env.DB, org, actor, 'CHAT_TURN_COMPLETED', turn.id, { model: MODEL, promptVersion: CHAT_PROMPT_VERSION, channel, calls: result.calls, rounds: result.rounds }),
      idem.save(response), clearGuard(env.DB, guardId),
    ]);
    return json(response);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'CHAT_FAILED';
    await stmt(env.DB, "UPDATE chat_turns SET state = 'FAILED', error_code = ?, lease_token = NULL WHERE id = ? AND state = 'PROCESSING' AND lease_token = ?", code, turn.id, token).run();
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'CHAT_FAILED', 'No pude completar la conversación. No se ejecutó ninguna propuesta.');
  }
}

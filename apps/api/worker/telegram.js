import { MAX_INVOICE_BYTES, TelegramIntegrationSchema, TelegramLinkSchema } from '@oli/contracts';
import { audit, equalSecret, HttpError, id, json, now, readBytes, sha256, stmt } from './http.js';
import { receiveInvoice } from './invoices.js';
import { processInvoice } from './processing.js';
import { telegramAction, telegramChat, telegramConnection, telegramContext, telegramParts } from './telegram-chat.js';

const activeConnection = (db, orgId, userId) => stmt(db, `SELECT * FROM telegram_connections
  WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL`, orgId, userId).first();
const available = env => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_QUEUE && env.PUBLIC_APP_URL);

async function telegram(env, method, data) {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken ?? '')) {
    throw new HttpError(503, 'TELEGRAM_BOT_TOKEN_INVALID', 'El token del bot no es válido. Revisa TELEGRAM_BOT_TOKEN en el Worker.');
  }
  let status = null; let phase = 'fetch';
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      signal: AbortSignal.timeout(12000), redirect: 'manual',
    });
    status = response.status; phase = 'parse';
    const result = JSON.parse(new TextDecoder().decode(await readBytes(response, 64 * 1024)));
    phase = 'response';
    if (response.status === 401 || response.status === 404) {
      throw new HttpError(503, 'TELEGRAM_BOT_TOKEN_INVALID', 'Telegram rechazó el token del bot. Revisa TELEGRAM_BOT_TOKEN en el Worker.');
    }
    if (response.status === 400 && method === 'setWebhook') {
      throw new HttpError(503, 'TELEGRAM_WEBHOOK_REJECTED', 'Telegram rechazó el webhook. Revisa TELEGRAM_WEBHOOK_SECRET y la dirección pública de Oli.');
    }
    if (!response.ok || result.ok !== true) throw new Error('telegram');
    return result.result;
  } catch (error) {
    const reason = /redirect/i.test(error?.message ?? '') ? 'REDIRECT'
      : /DNS|resolve|hostname/i.test(error?.message ?? '') ? 'DNS'
        : /network|connection|TLS|SSL|certificate/i.test(error?.message ?? '') ? 'NETWORK'
          : /timeout|aborted/i.test(error?.message ?? '') ? 'TIMEOUT'
            : /not a function|invocation/i.test(error?.message ?? '') ? 'RUNTIME_API' : 'UPSTREAM';
    console.error(JSON.stringify({ event: 'telegram_api_failed', method, status, phase, reason, errorName: error?.name }));
    if (error instanceof HttpError && error.code.startsWith('TELEGRAM_')) throw error;
    // Telegram URLs contain the bot token; never propagate upstream exceptions or URLs.
    throw new HttpError(503, 'TELEGRAM_UNAVAILABLE', 'No se pudo conectar con Telegram. Intenta de nuevo.');
  }
}

export async function telegramStatus(env, session) {
  const connection = await activeConnection(env.DB, session.organization.id, session.user.id);
  return json({ data: TelegramIntegrationSchema.parse({ available: available(env), connection: connection ? {
    id: connection.id, displayName: connection.display_name, connectedAt: connection.connected_at,
  } : null }) });
}

export async function createTelegramLink(env, session) {
  if (!available(env)) throw new HttpError(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram aún no está disponible. Intenta más tarde.');
  if (await activeConnection(env.DB, session.organization.id, session.user.id)) {
    throw new HttpError(409, 'TELEGRAM_ALREADY_CONNECTED', 'Tu cuenta ya tiene Telegram conectado.');
  }
  const bot = await configureTelegram(env);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
  await env.DB.batch([
    stmt(env.DB, 'DELETE FROM telegram_link_tokens WHERE org_id = ? AND user_id = ? AND connection_id IS NULL', session.organization.id, session.user.id),
    stmt(env.DB, 'INSERT INTO telegram_link_tokens(token_hash, org_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
      await sha256(token), session.organization.id, session.user.id, expiresAt),
  ]);
  return json({ data: TelegramLinkSchema.parse({ url: `https://t.me/${bot.username}?start=${token}`, expiresAt }) }, 201);
}

export async function configureTelegram(env) {
  if (!available(env)) throw new HttpError(503, 'TELEGRAM_NOT_CONFIGURED');
  const bot = await telegram(env, 'getMe', {});
  if (!/^[A-Za-z0-9_]+$/.test(bot.username ?? '')) throw new HttpError(503, 'TELEGRAM_UNAVAILABLE');
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET.trim();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    throw new HttpError(503, 'TELEGRAM_WEBHOOK_SECRET_INVALID', 'El secreto del webhook no es válido. Genera uno con openssl rand -hex 32.');
  }
  await telegram(env, 'setWebhook', {
    url: new URL('/api/channels/telegram/webhook', env.PUBLIC_APP_URL).href,
    secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'],
  });
  return bot;
}

export async function disconnectTelegram(env, session) {
  const connection = await activeConnection(env.DB, session.organization.id, session.user.id);
  await env.DB.batch([
    stmt(env.DB, 'UPDATE telegram_connections SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL',
      now(), session.organization.id, session.user.id),
    stmt(env.DB, 'DELETE FROM telegram_link_tokens WHERE org_id = ? AND user_id = ? AND connection_id IS NULL', session.organization.id, session.user.id),
    ...(connection ? [audit(env.DB, session.organization.id, session.user.id, 'TELEGRAM_DISCONNECTED', connection.id, {})] : []),
  ]);
  return new Response(null, { status: 204 });
}

export async function telegramWebhook(request, env) {
  try {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!available(env)) throw new HttpError(503, 'TELEGRAM_NOT_CONFIGURED');
    if (!await equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', env.TELEGRAM_WEBHOOK_SECRET.trim())) {
      throw new HttpError(403, 'FORBIDDEN');
    }
    let update;
    try { update = JSON.parse(new TextDecoder().decode(await readBytes(request, 64 * 1024))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'VALIDATION_ERROR'); }
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) throw new HttpError(400, 'VALIDATION_ERROR');
    const callback = update.callback_query;
    const m = callback?.message ?? update.message;
    const sender = callback?.from ?? m?.from;
    // MVP accepts private conversations only; forwarded names never identify the Oli member.
    if (!m || m.chat?.type !== 'private' || !Number.isSafeInteger(sender?.id) || sender.id <= 0
      || sender.is_bot || m.chat.id !== sender.id) return json({ ok: true });
    const choice = typeof callback?.data === 'string' ? callback.data.match(/^([cx]):([a-f0-9-]{36})$/) : null;
    if (callback && (!choice || m.from?.is_bot !== true || !Number.isSafeInteger(m.message_id)
      || typeof callback.id !== 'string' || callback.id.length > 200)) return json({ ok: true });
    const userId = String(sender.id);
    const connection = await stmt(env.DB, `SELECT c.id FROM telegram_connections c JOIN memberships m
      ON m.org_id = c.org_id AND m.user_id = c.user_id
      WHERE c.telegram_user_id = ? AND c.revoked_at IS NULL`, userId).first();
    const start = !callback && typeof m.text === 'string' ? m.text.match(/^\/(?:start|login)(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{64})$/) : null;
    const photo = Array.isArray(m.photo) ? m.photo.at(-1) : null;
    const file = m.document ?? photo;
    const payload = { userId, chatId: userId, displayName: String(sender.first_name ?? 'Telegram').slice(0, 100),
      tokenHash: start ? await sha256(start[1]) : null,
      text: start || callback ? null : typeof m.text === 'string' ? m.text.slice(0, 4001) : null,
      callback: callback ? { id: callback.id, offerId: choice[2], confirm: choice[1] === 'c', messageId: m.message_id } : null,
      file: !callback && file && typeof file.file_id === 'string' && file.file_id.length <= 512 ? {
        id: file.file_id, name: typeof file.file_name === 'string' ? file.file_name.slice(0, 200) : 'factura.jpg',
        mimeType: photo && !m.document ? 'image/jpeg' : String(file.mime_type ?? ''),
        size: Number.isSafeInteger(file.file_size) ? file.file_size : null,
      } : null };
    await stmt(env.DB, `INSERT INTO telegram_events(update_id, operation_key, connection_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(update_id) DO NOTHING`, update.update_id, crypto.randomUUID(),
      connection?.id ?? null, JSON.stringify(payload), now()).run();
    // A failed enqueue returns 503 so Telegram retries. The receipt and financial effects are idempotent.
    await env.TELEGRAM_QUEUE.send({ updateId: update.update_id });
    if (callback) {
      try { await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Revisando propuesta…' }); }
      catch { /* The durable event can still complete if Telegram's short-lived callback expired. */ }
    }
    return json({ ok: true });
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error(JSON.stringify({ event: 'telegram_webhook_failed' }));
    return json({ error: { code: known ? error.code : 'INTERNAL_ERROR' } }, known ? error.status : 503);
  }
}

async function linkAccount(env, payload) {
  const connectionId = id('tg'); const time = now();
  await env.DB.batch([
    stmt(env.DB, `INSERT INTO telegram_connections(id, org_id, user_id, telegram_user_id, chat_id, display_name, connected_at)
      SELECT ?, t.org_id, t.user_id, ?, ?, ?, ? FROM telegram_link_tokens t
      JOIN memberships m ON m.org_id = t.org_id AND m.user_id = t.user_id
      WHERE t.token_hash = ? AND t.expires_at > ? AND t.connection_id IS NULL
      ON CONFLICT DO NOTHING`, connectionId, payload.userId, payload.chatId, payload.displayName, time, payload.tokenHash, time),
    stmt(env.DB, `UPDATE telegram_link_tokens SET connection_id = ? WHERE token_hash = ? AND connection_id IS NULL
      AND EXISTS (SELECT 1 FROM telegram_connections WHERE id = ?)`, connectionId, payload.tokenHash, connectionId),
    stmt(env.DB, `INSERT INTO audit_events(id,org_id,actor_kind,actor_id,type,entity_id,details_json,created_at)
      SELECT ?,org_id,'HUMAN',user_id,'TELEGRAM_CONNECTED',id,'{}',? FROM telegram_connections WHERE id = ?`, id('evt'), time, connectionId),
  ]);
  const connection = await stmt(env.DB, `SELECT c.*, o.name AS org_name FROM telegram_link_tokens t
    JOIN telegram_connections c ON c.id = t.connection_id JOIN organizations o ON o.id = c.org_id
    JOIN memberships m ON m.org_id = c.org_id AND m.user_id = c.user_id
    WHERE t.token_hash = ? AND c.telegram_user_id = ? AND c.revoked_at IS NULL`, payload.tokenHash, payload.userId).first();
  if (!connection) return 'No pude vincular tu cuenta. El enlace venció o ya existe una conexión. Genera uno nuevo en Integraciones de Oli.';
  return `Conectado a ${connection.org_name}. ¡Hola! Soy Oli. Puedes preguntarme por tus facturas, proveedores o presupuesto, o enviarme una factura en PDF, JPG o PNG de hasta 5 MB.`;
}

async function authorizedConnection(env, connectionId) {
  return telegramConnection(env, connectionId);
}

async function textReply(env, row, payload) {
  // A text greeting may have arrived while its preceding /start was still being consumed.
  const found = row.connection_id ? null : await stmt(env.DB, `SELECT c.id FROM telegram_connections c JOIN memberships m
    ON m.org_id = c.org_id AND m.user_id = c.user_id
    WHERE c.telegram_user_id = ? AND c.chat_id = ? AND c.revoked_at IS NULL`, payload.userId, payload.chatId).first();
  if (found) {
    await stmt(env.DB, 'UPDATE telegram_events SET connection_id = ? WHERE update_id = ? AND connection_id IS NULL', found.id, row.update_id).run();
    row.connection_id = found.id;
  }
  const connection = row.connection_id && await authorizedConnection(env, row.connection_id);
  return connection ? telegramChat(env, row, payload, connection)
    : [{ text: `Conecta tu cuenta en Integraciones de Oli para conversar conmigo o enviarme una factura.\n${env.PUBLIC_APP_URL}/app/integrations` }];
}

async function invoiceReply(env, row, payload, process) {
  const connection = await authorizedConnection(env, row.connection_id);
  if (!connection) return 'Conecta tu cuenta desde Integraciones en Oli antes de enviar facturas.';
  if (payload.file.size !== null && payload.file.size > MAX_INVOICE_BYTES) return 'El archivo supera 5 MB. Envíame una versión más pequeña.';
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(payload.file.mimeType)) return 'Envíame la factura en PDF, JPG o PNG.';
  let source = await stmt(env.DB, 'SELECT invoice_id FROM invoice_sources WHERE telegram_update_id = ?', row.update_id).first();
  if (!source) {
    const remote = await telegram(env, 'getFile', { file_id: payload.file.id });
    if (remote.file_size > MAX_INVOICE_BYTES) return 'El archivo supera 5 MB. Envíame una versión más pequeña.';
    // getFile is server-to-server; nevertheless constrain its path before using the bot credential.
    if (typeof remote.file_path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(remote.file_path)
      || remote.file_path.split('/').includes('..') || remote.file_path.startsWith('/')) throw new HttpError(503, 'TELEGRAM_UNAVAILABLE');
    let bytes;
    try {
      const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN.trim()}/${remote.file_path}`,
        { signal: AbortSignal.timeout(12000), redirect: 'manual' });
      if (!response.ok) throw new Error('download');
      bytes = await readBytes(response, MAX_INVOICE_BYTES);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'TELEGRAM_UNAVAILABLE');
    }
    if (!await authorizedConnection(env, row.connection_id)) return null;
    const request = new Request(`${env.PUBLIC_APP_URL}/api/v1/invoices`, {
      method: 'POST', headers: { 'Idempotency-Key': row.operation_key },
    });
    const response = await receiveInvoice(request, env,
      { user: { id: connection.user_id }, organization: { id: connection.org_id } },
      new File([bytes], payload.file.name, { type: payload.file.mimeType }), row.update_id);
    source = { invoice_id: (await response.json()).data.id };
  }
  if (!await authorizedConnection(env, row.connection_id)) return null;
  await telegramContext(env, connection);
  await stmt(env.DB, 'UPDATE telegram_conversations SET last_invoice_id = ? WHERE connection_id = ?', source.invoice_id, connection.id).run();
  const result = await process(env, connection.org_id, source.invoice_id);
  const invoice = result.data;
  const url = new URL(`/app/bills/${encodeURIComponent(source.invoice_id)}`, env.PUBLIC_APP_URL).href;
  if (result.status === 202 || (invoice.status === 'FAILED' && invoice.processingError?.retryable)) throw new Error('retry_processing');
  if (invoice.status === 'FAILED') return `No pude leer la factura. Revisa el documento en Oli.\n${url}`;
  const title = { APPROVE: 'Factura aprobada según tus reglas.', BLOCK: 'Factura bloqueada.', ESCALATE: 'La factura necesita revisión.' }[invoice.latestDecision?.action];
  return `${title ?? 'Factura recibida.'}\n${invoice.latestDecision?.humanExplanation ?? 'Revisa el estado en Oli.'}\n${url}`;
}

export async function consumeTelegram(batch, env, process = processInvoice) {
  for (const message of batch.messages) {
    const updateId = message.body?.updateId;
    if (!Number.isSafeInteger(updateId)) { message.ack(); continue; }
    const lease = id('tgwork');
    const row = await stmt(env.DB, `UPDATE telegram_events SET state = 'RUNNING', lease_token = ?, lease_until = ?
      WHERE update_id = ? AND (state = 'PENDING' OR (state = 'RUNNING' AND lease_until < ?)) RETURNING *`,
      lease, new Date(Date.now() + 180000).toISOString(), updateId, now()).first();
    if (!row) {
      const event = await stmt(env.DB, 'SELECT state FROM telegram_events WHERE update_id = ?', updateId).first();
      if (event?.state === 'RUNNING') message.retry({ delaySeconds: 180 }); else message.ack();
      continue;
    }
    const payload = JSON.parse(row.payload_json);
    try {
      let parts = row.reply_json ? JSON.parse(row.reply_json) : null;
      if (!parts) {
        let reply = payload.tokenHash || payload.file ? row.reply_text : null;
        try {
          if (reply === null) reply = payload.tokenHash ? await linkAccount(env, payload)
            : payload.callback ? await telegramAction(env, row, payload)
            : payload.file ? await invoiceReply(env, row, payload, process)
              : await textReply(env, row, payload);
        } catch (error) {
          if (error instanceof HttpError && [400, 413, 415].includes(error.status)) reply = 'No pude aceptar el archivo. Revisa que sea un PDF, JPG o PNG válido de hasta 5 MB.';
          else if (error instanceof HttpError && error.code === 'MANDATE_REQUIRED') reply = 'Activa las reglas de tu empresa en Oli antes de procesar facturas.';
          else throw error;
        }
        parts = Array.isArray(reply) ? reply : reply ? telegramParts(reply) : [];
        await stmt(env.DB, 'UPDATE telegram_events SET reply_json = ? WHERE update_id = ? AND lease_token = ?', JSON.stringify(parts), updateId, lease).run();
      }
      // Re-check even cached model replies; a revoked connection must never receive private data.
      for (let i = row.delivered_parts; i < parts.length; i++) {
        if (row.connection_id && !await authorizedConnection(env, row.connection_id)) break;
        const part = parts[i];
        const sent = await telegram(env, 'sendMessage', { chat_id: payload.chatId, text: part.text,
          ...(part.reply_markup ? { reply_markup: part.reply_markup } : {}) });
        const mutations = [stmt(env.DB, 'UPDATE telegram_events SET delivered_parts = ?, lease_until = ? WHERE update_id = ? AND lease_token = ?',
          i + 1, new Date(Date.now() + 180000).toISOString(), updateId, lease)];
        if (part.offerId) {
          if (!Number.isSafeInteger(sent?.message_id)) throw new Error('telegram_message_id_missing');
          mutations.push(stmt(env.DB, 'UPDATE telegram_action_offers SET message_id = ? WHERE id = ? AND connection_id = ?', sent.message_id, part.offerId, row.connection_id));
        }
        await env.DB.batch(mutations);
      }
      await stmt(env.DB, "UPDATE telegram_events SET state = 'DONE', completed_at = ?, lease_token = NULL, lease_until = NULL WHERE update_id = ? AND lease_token = ?", now(), updateId, lease).run();
      message.ack();
    } catch (error) {
      const exhausted = message.attempts >= 5;
      await stmt(env.DB, 'UPDATE telegram_events SET state = ?, lease_token = NULL, lease_until = NULL WHERE update_id = ? AND lease_token = ?', exhausted ? 'FAILED' : 'PENDING', updateId, lease).run();
      console.error(JSON.stringify({ event: 'telegram_event_failed', updateId, exhausted }));
      if (exhausted) message.ack(); else message.retry({ delaySeconds: error?.code === 'CHAT_IN_PROGRESS' ? 15 : env.INVOICE_QUEUE ? 120 : 30 });
    }
  }
}

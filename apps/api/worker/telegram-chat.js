import { chatMessage } from './chat.js';
import { cancelAction, confirmAction, inspectInvoice } from './chat-actions.js';
import { HttpError, now, stmt } from './http.js';
import { invoiceSummary, money } from './telegram-invoice.js';
export { money } from './telegram-invoice.js';

export async function telegramConnection(env, connectionId) {
  return stmt(env.DB, `SELECT c.*, m.role, o.name AS org_name, o.timezone, o.default_currency,
    u.name AS user_name, u.email FROM telegram_connections c
    JOIN memberships m ON m.org_id = c.org_id AND m.user_id = c.user_id
    JOIN organizations o ON o.id = c.org_id JOIN users u ON u.id = c.user_id
    WHERE c.id = ? AND c.revoked_at IS NULL`, connectionId).first();
}

const sessionFor = c => ({ user: { id: c.user_id, name: c.user_name, email: c.email },
  organization: { id: c.org_id, name: c.org_name, timezone: c.timezone, defaultCurrency: c.default_currency }, role: c.role });

export async function telegramContext(env, connection) {
  const conversationId = `chat_${connection.id}`;
  await env.DB.batch([
    stmt(env.DB, `INSERT INTO chat_conversations(id, org_id, user_id, created_at, updated_at, channel)
      VALUES (?, ?, ?, ?, ?, 'TELEGRAM') ON CONFLICT(id) DO NOTHING`, conversationId, connection.org_id, connection.user_id, now(), now()),
    stmt(env.DB, `INSERT INTO telegram_conversations(connection_id, org_id, user_id, conversation_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(connection_id) DO NOTHING`, connection.id, connection.org_id, connection.user_id, conversationId),
  ]);
  return stmt(env.DB, 'SELECT * FROM telegram_conversations WHERE connection_id = ? AND org_id = ? AND user_id = ?',
    connection.id, connection.org_id, connection.user_id).first();
}

const internalRequest = (env, route, key, value) => new Request(new URL(`/api/v1${route}`, env.PUBLIC_APP_URL), {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(value),
});

// Split by Unicode code point so a Telegram message never ends with half an emoji.
export function telegramParts(text) {
  const chars = Array.from(text), parts = [];
  for (let i = 0; i < chars.length; i += 1800) parts.push({ text: chars.slice(i, i + 1800).join('') });
  return parts;
}

const labels = { name: 'Nombre', allowed: 'Autorizado', externalRef: 'Referencia', vendorId: 'Proveedor',
  currency: 'Moneda', amountMinor: 'Importe', toleranceMinor: 'Tolerancia',
  frequency: 'Frecuencia', concept: 'Concepto', active: 'Activo' };
const fields = (value, currency = value?.currency) => Object.entries(value ?? {}).filter(([key]) => Object.hasOwn(labels, key))
  .map(([key, v]) => `${labels[key]}: ${v === null ? 'sin referencia' : v === true ? 'sí' : v === false ? 'no'
    : ['amountMinor', 'toleranceMinor'].includes(key) && currency ? money(v, currency)
      : v === 'MONTHLY' ? 'mensual' : v === 'ONE_TIME' ? 'una vez' : v}`).join('\n');
const titles = { CREATE_VENDOR: 'Registrar proveedor', UPDATE_VENDOR: 'Actualizar proveedor',
  CREATE_AGREEMENT: 'Crear acuerdo', UPDATE_AGREEMENT: 'Actualizar acuerdo',
  ONBOARD_INVOICE_VENDOR: 'Registrar proveedor de la factura y reevaluarla', RESUME_INVOICE: 'Reevaluar factura con proveedor registrado' };

function proposalText(action, invoice) {
  const p = action.proposal;
  return [`Propuesta: ${titles[p.kind]}.`, invoice ? `Factura: ${invoice.invoiceNumber ?? invoice.file.name}\n${invoice.vendorName ?? 'Proveedor desconocido'}${invoice.amountMinor !== null && invoice.currency ? `\n${money(invoice.amountMinor, invoice.currency)}` : ''}` : '',
    action.before ? `Registro actual:\n${fields(action.before)}` : '',
    p.data ? `Datos propuestos:\n${fields(p.data, p.data.currency ?? action.before?.currency)}` : '', p.vendor ? `Proveedor:\n${fields(p.vendor)}` : '',
    p.agreement ? `Acuerdo:\n${fields(p.agreement)}` : p.kind === 'ONBOARD_INVOICE_VENDOR' ? 'Sin acuerdo nuevo.' : '',
    'Revisa los datos. Solo se aplicará al pulsar Confirmar.', `Vence: ${action.expiresAt}.`].filter(Boolean).join('\n\n');
}

export async function telegramChat(env, row, payload, connection) {
  if (!payload.text?.trim()) return [{ text: 'Puedes escribirme una pregunta o enviarme una factura en PDF, JPG o PNG de hasta 5 MB.' }];
  if (payload.text.length > 4000) return [{ text: 'Envíame el mensaje en partes de hasta 4000 caracteres.' }];
  const context = await telegramContext(env, connection);
  // A retry must keep the original attachment and conversation, even if newer documents arrived.
  const oldTurn = await stmt(env.DB, 'SELECT conversation_id, invoice_ids_json FROM chat_turns WHERE org_id = ? AND user_id = ? AND client_key = ?',
    connection.org_id, connection.user_id, row.operation_key).first();
  const input = { conversationId: oldTurn?.conversation_id ?? context.conversation_id,
    text: /^\/(?:start|help)(?:@[A-Za-z0-9_]+)?$/.test(payload.text.trim()) ? 'Hola, ¿en qué me puedes ayudar aquí?' : payload.text,
    invoiceIds: oldTurn ? JSON.parse(oldTurn.invoice_ids_json) : context.last_invoice_id ? [context.last_invoice_id] : [] };
  let result;
  try {
    const response = await chatMessage(internalRequest(env, '/chat/messages', row.operation_key, input), env, sessionFor(connection), 'telegram');
    result = (await response.json()).data;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.code === 'CHAT_IN_PROGRESS') throw error;
    if (error.status === 429) return [{ text: 'Vamos a pausar unos minutos: alcanzaste el límite de conversación. Luego puedes seguir aquí.' }];
    if (error.status >= 500 || error.code === 'CHAT_RETRY_LIMIT') return [{ text: 'No pude completar la respuesta en este momento. Intenta enviarme tu mensaje de nuevo. No se ejecutó ninguna propuesta.' }];
    throw error;
  }
  const parts = telegramParts(result.text);
  for (const action of result.actions) {
    const offerId = crypto.randomUUID();
    await stmt(env.DB, `INSERT INTO telegram_action_offers(id, connection_id, action_id, update_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(connection_id, action_id) DO NOTHING`, offerId, connection.id, action.id, row.update_id).run();
    const offer = await stmt(env.DB, 'SELECT id FROM telegram_action_offers WHERE connection_id = ? AND action_id = ?', connection.id, action.id).first();
    const invoice = action.proposal.invoiceId ? (await inspectInvoice(env, sessionFor(connection), action.proposal.invoiceId)).invoice : null;
    const summary = telegramParts(proposalText(action, invoice));
    summary.at(-1).offerId = offer.id;
    summary.at(-1).reply_markup = { inline_keyboard: [[
      { text: 'Confirmar', callback_data: `c:${offer.id}` }, { text: 'Cancelar', callback_data: `x:${offer.id}` },
    ]] };
    parts.push(...summary);
  }
  return parts;
}

export async function telegramAction(env, row, payload) {
  const connection = await telegramConnection(env, row.connection_id);
  const offer = connection && await stmt(env.DB, `SELECT * FROM telegram_action_offers
    WHERE id = ? AND connection_id = ? AND message_id = ?`, payload.callback.offerId, connection.id, payload.callback.messageId).first();
  if (!offer || connection.telegram_user_id !== payload.userId || connection.chat_id !== payload.chatId) {
    return [{ text: 'Ese botón no corresponde a tu conexión activa. Pide una propuesta nueva.' }];
  }
  try {
    const route = `/chat/actions/${offer.action_id}/${payload.callback.confirm ? 'confirm' : 'cancel'}`;
    const request = internalRequest(env, route, row.operation_key, { confirmed: true });
    const response = payload.callback.confirm
      ? await confirmAction(request, env, sessionFor(connection), offer.action_id, connection.id)
      : await cancelAction(request, env, sessionFor(connection), offer.action_id);
    const result = (await response.json()).data;
    return [{ text: payload.callback.confirm
      ? `Listo, guardé el cambio.${result.invoice ? `\n${invoiceSummary(result.invoice)}` : ''}`
      : 'Propuesta cancelada. No se aplicó el cambio.' }];
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
    return [{ text: error.status === 403 ? 'Tu rol no permite confirmar cambios.'
      : 'No se pudo aplicar esa propuesta: venció, ya fue resuelta o cambiaron los datos. Pídeme una propuesta nueva.' }];
  }
}

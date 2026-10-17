import PostalMime from 'postal-mime';
import { EmailIntegrationSchema, InboxSchema, MAX_INVOICE_BYTES } from '@oli/contracts';
import { owner } from './auth.js';
import { audit, HttpError, id, json, now, readBytes, sha256, stmt } from './http.js';
import { receiveInvoice } from './invoices.js';
import { getInvoice } from './repository.js';
import { telegram } from './telegram.js';
import { money, telegramConnection, telegramContext, telegramParts } from './telegram-chat.js';

const MAX_EMAIL_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const clean = (value, limit) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit);
const configured = env => !!(env.EMAIL_QUEUE && /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.EMAIL_BASE_ADDRESS ?? ''));
const mailboxFor = (env, org) => stmt(env.DB, 'SELECT * FROM email_mailboxes WHERE org_id = ?', org).first();

export async function emailStatus(env, session) {
  const row = await mailboxFor(env, session.organization.id);
  return json({ data: EmailIntegrationSchema.parse({ available: configured(env), mailbox: row ? {
    address: row.address, enabled: !!row.enabled, createdAt: row.created_at,
  } : null }) });
}

export async function enableEmail(env, session) {
  owner(session);
  if (!configured(env)) throw new HttpError(503, 'EMAIL_NOT_CONFIGURED', 'La recepción de correo todavía no está configurada.');
  const [local, domain] = env.EMAIL_BASE_ADDRESS.toLowerCase().split('@');
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    stmt(env.DB, `INSERT INTO email_mailboxes(id,org_id,user_id,address,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(org_id) DO UPDATE SET enabled = 1`, id('mbx'), session.organization.id, session.user.id, `${local}+${token}@${domain}`, now()),
    audit(env.DB, session.organization.id, session.user.id, 'EMAIL_ENABLED', session.organization.id, {}),
  ]);
  return emailStatus(env, session);
}

export async function disableEmail(env, session) {
  owner(session);
  await env.DB.batch([
    stmt(env.DB, 'UPDATE email_mailboxes SET enabled = 0 WHERE org_id = ?', session.organization.id),
    audit(env.DB, session.organization.id, session.user.id, 'EMAIL_DISABLED', session.organization.id, {}),
  ]);
  return new Response(null, { status: 204 });
}

async function publishEmail(env, messageId) {
  if (!env.EMAIL_QUEUE) return false;
  const time = now();
  const claimed = await stmt(env.DB, `UPDATE email_messages SET enqueued_at = ? WHERE id = ? AND notified_at IS NULL
    AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?)
    AND (enqueued_at IS NULL OR enqueued_at < ?) RETURNING id`,
  time, messageId, time, time, new Date(Date.now() - 60000).toISOString()).first();
  if (!claimed) return false;
  try { await env.EMAIL_QUEUE.send({ kind: 'EMAIL_MESSAGE', messageId }); return true; }
  catch {
    await stmt(env.DB, 'UPDATE email_messages SET enqueued_at = NULL WHERE id = ? AND enqueued_at = ?', messageId, time).run();
    console.error(JSON.stringify({ event: 'email_dispatch_deferred', messageId }));
    return false;
  }
}

export async function recoverEmails(env) {
  if (!env.EMAIL_QUEUE) return;
  const rows = (await stmt(env.DB, `SELECT id FROM email_messages WHERE notified_at IS NULL AND next_attempt_at <= ?
    AND (lease_until IS NULL OR lease_until < ?) AND (enqueued_at IS NULL OR enqueued_at < ?)
    ORDER BY received_at LIMIT 25`, now(), now(), new Date(Date.now() - 60000).toISOString()).all()).results;
  for (const row of rows) await publishEmail(env, row.id);
}

export async function wakeEmailInvoices(batch, env) {
  if (!env.EMAIL_QUEUE) return;
  for (const message of batch.messages) {
    if (typeof message.body?.jobId !== 'string') continue;
    const rows = (await stmt(env.DB, `SELECT DISTINCT e.id FROM email_messages e
      JOIN email_attachments a ON a.org_id = e.org_id AND a.message_id = e.id
      JOIN email_invoice_sources s ON s.org_id = a.org_id AND s.attachment_id = a.id
      JOIN invoice_jobs j ON j.org_id = s.org_id AND j.invoice_id = s.invoice_id
      WHERE j.id = ? AND j.state IN ('DONE','DEAD') AND e.notified_at IS NULL`, message.body.jobId).all()).results;
    for (const row of rows) {
      await stmt(env.DB, 'UPDATE email_messages SET next_attempt_at = ?, enqueued_at = NULL WHERE id = ?', now(), row.id).run();
      await publishEmail(env, row.id);
    }
  }
}

function documentMime(bytes) {
  for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
    if (type === 'application/pdf' && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return type;
    if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return type;
    if (type === 'image/png' && [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return type;
  }
  return null;
}

export async function receiveEmail(message, env) {
  if (!configured(env)) { message.setReject('Oli no tiene habilitada la recepción de correo.'); return; }
  // Only the SMTP envelope recipient selects the company, never From, To headers or document text.
  const mailbox = await stmt(env.DB, `SELECT e.* FROM email_mailboxes e JOIN memberships m
    ON m.org_id = e.org_id AND m.user_id = e.user_id WHERE e.address = ? AND e.enabled = 1`, String(message.to).toLowerCase()).first();
  if (!mailbox) { message.setReject('Dirección de Oli no disponible.'); return; }
  if (message.rawSize > MAX_EMAIL_BYTES) { message.setReject('El correo supera 12 MB. Divide los documentos en varios correos.'); return; }
  let parsed;
  try {
    const bytes = await readBytes(new Response(message.raw), MAX_EMAIL_BYTES);
    parsed = await PostalMime.parse(bytes, { maxNestingDepth: 12, maxPartCount: 64, maxHeadersSize: 32768, maxRfc822NestingDepth: 0 });
  } catch {
    message.setReject('No pude leer el correo. Envía un correo con adjuntos PDF, JPG o PNG válidos de hasta 5 MB.'); return;
  }
  const sender = clean(message.from, 254), subject = clean(parsed.subject, 200) || 'Sin asunto';
  const documents = [];
  for (const part of parsed.attachments ?? []) {
    // Inline logos and tracking images are not invoice attachments.
    if (part.contentId && part.disposition === 'inline' && part.mimeType !== 'application/pdf') continue;
    const content = new Uint8Array(part.content), mime = documentMime(content);
    if (!mime) continue;
    if (!content.length || content.length > MAX_INVOICE_BYTES) { message.setReject('Cada documento debe pesar hasta 5 MB.'); return; }
    documents.push({ content, mime, name: clean(part.filename, 200) || `documento.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`,
      hash: await sha256(content) });
  }
  if (documents.length > 4 || documents.reduce((n,d) => n + d.content.length, 0) > MAX_DOCUMENT_BYTES) {
    message.setReject('Envía hasta cuatro documentos y 8 MB de adjuntos por correo.'); return;
  }
  // Transport headers can change during SMTP retries. Message-ID alone is sender-controlled.
  const messageKey = await sha256(JSON.stringify({ sender, subject, messageId: parsed.messageId ?? null,
    body: await sha256(parsed.text ?? parsed.html ?? ''), documents: documents.map(d => [d.name, d.mime, d.hash]) }));
  const prior = await stmt(env.DB, 'SELECT id FROM email_messages WHERE org_id = ? AND message_key = ?', mailbox.org_id, messageKey).first();
  if (prior) { await publishEmail(env, prior.id); return; }
  const count = await stmt(env.DB, 'SELECT count(*) AS n FROM email_messages WHERE org_id = ? AND received_at > ?', mailbox.org_id,
    new Date(Date.now() - 3600000).toISOString()).first('n');
  if (count >= 20) { message.setReject('Se alcanzó el límite de recepción de Oli. Intenta más tarde.'); return; }
  const messageId = id('mail'), time = now(), guardId = id('guard');
  const attachments = documents.map((d, position) => ({ ...d, position, id: id('att'), key: `email/${mailbox.org_id}/${messageId}/${position}`, operation: crypto.randomUUID() }));
  try {
    for (const a of attachments) await env.INVOICES.put(a.key, a.content, { httpMetadata: { contentType: a.mime } });
    await env.DB.batch([
      stmt(env.DB, `INSERT INTO commit_guards(id,valid) VALUES (?, EXISTS(SELECT 1 FROM email_mailboxes WHERE id = ? AND enabled = 1)
        AND (SELECT count(*) FROM email_messages WHERE org_id = ? AND received_at > ?) < 20)`,
      guardId, mailbox.id, mailbox.org_id, new Date(Date.now() - 3600000).toISOString()),
      stmt(env.DB, `INSERT INTO email_messages(id,org_id,mailbox_id,message_key,sender,subject,received_at,state,next_attempt_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, messageId, mailbox.org_id, mailbox.id, messageKey, sender, subject, time, documents.length ? 'RECEIVED' : 'NO_DOCUMENT', time),
      ...attachments.map(a => stmt(env.DB, `INSERT INTO email_attachments(id,org_id,message_id,position,file_key,file_name,mime_type,size_bytes,sha256,operation_key)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, a.id, mailbox.org_id, messageId, a.position, a.key, a.name, a.mime, a.content.length, a.hash, a.operation)),
      stmt(env.DB, `INSERT INTO email_telegram_deliveries(org_id,message_id,connection_id)
        SELECT ?,?,c.id FROM telegram_connections c JOIN memberships m ON m.org_id = c.org_id AND m.user_id = c.user_id
        WHERE c.org_id = ? AND c.revoked_at IS NULL`, mailbox.org_id, messageId, mailbox.org_id),
      audit(env.DB, mailbox.org_id, null, 'EMAIL_RECEIVED', messageId, { attachmentCount: attachments.length }),
      stmt(env.DB, 'DELETE FROM commit_guards WHERE id = ?', guardId),
    ]);
  } catch (error) {
    await Promise.all(attachments.map(a => env.INVOICES.delete(a.key)));
    const replay = await stmt(env.DB, 'SELECT id FROM email_messages WHERE org_id = ? AND message_key = ?', mailbox.org_id, messageKey).first();
    if (replay) { await publishEmail(env, replay.id); return; }
    if (/CHECK constraint/.test(String(error))) { message.setReject('La dirección no está disponible o se alcanzó el límite de recepción.'); return; }
    throw error; // A temporary storage failure must not acknowledge and lose the email.
  }
  await publishEmail(env, messageId);
}

async function attachmentRows(env, row) {
  return (await stmt(env.DB, `SELECT a.*, s.invoice_id FROM email_attachments a LEFT JOIN email_invoice_sources s
    ON s.org_id = a.org_id AND s.attachment_id = a.id WHERE a.org_id = ? AND a.message_id = ? ORDER BY a.position`, row.org_id, row.id).all()).results;
}

const summaryFor = row => row.state === 'NO_DOCUMENT' ? 'Este correo no tiene adjuntos PDF, JPG o PNG compatibles.'
  : row.state === 'FAILED' ? 'No pude completar la lectura del correo. Revisa los documentos.'
    : row.state === 'COMPLETED' ? 'Oli revisó los documentos. Abre cada uno para ver su decisión.' : 'Llegó un correo. Oli está revisando sus documentos.';

async function notifyTelegram(env, row, invoices, lease) {
  const deliveries = (await stmt(env.DB, 'SELECT * FROM email_telegram_deliveries WHERE org_id = ? AND message_id = ? AND delivered_at IS NULL', row.org_id, row.id).all()).results;
  for (const delivery of deliveries) {
    const parts = delivery.parts_json ? JSON.parse(delivery.parts_json) : telegramParts([
      'Llegó un correo para Oli.', `De: ${row.sender}`, `Asunto: ${row.subject}`, summaryFor(row),
      ...invoices.map(i => `${i.invoiceNumber ?? i.file.name}${i.vendorName ? ` · ${i.vendorName}` : ''}${i.amountMinor !== null && i.currency ? ` · ${money(i.amountMinor, i.currency)}` : ''}\n${i.latestDecision?.humanExplanation ?? i.processingError?.message ?? 'Pendiente de revisión.'}\n${new URL(`/app/bills/${encodeURIComponent(i.id)}`, env.PUBLIC_APP_URL).href}`),
      new URL('/app/inbox', env.PUBLIC_APP_URL).href,
    ].join('\n\n'));
    if (!delivery.parts_json) await stmt(env.DB, 'UPDATE email_telegram_deliveries SET parts_json = ? WHERE message_id = ? AND connection_id = ?', JSON.stringify(parts), row.id, delivery.connection_id).run();
    for (let index = delivery.delivered_parts; index < parts.length; index++) {
      const connection = await telegramConnection(env, delivery.connection_id);
      if (!connection || connection.org_id !== row.org_id || !(await mailboxFor(env, row.org_id))?.enabled) break;
      await telegram(env, 'sendMessage', { chat_id: connection.chat_id, text: parts[index].text });
      await env.DB.batch([
        stmt(env.DB, 'UPDATE email_telegram_deliveries SET delivered_parts = ? WHERE message_id = ? AND connection_id = ?', index + 1, row.id, connection.id),
        stmt(env.DB, 'UPDATE email_messages SET lease_until = ? WHERE id = ? AND lease_token = ?', new Date(Date.now() + 180000).toISOString(), row.id, lease),
      ]);
    }
    const connection = await telegramConnection(env, delivery.connection_id);
    if (connection && connection.org_id === row.org_id && invoices.length) {
      await telegramContext(env, connection);
      await stmt(env.DB, 'UPDATE telegram_conversations SET last_invoice_id = ? WHERE connection_id = ?', invoices.at(-1).id, connection.id).run();
    }
    await stmt(env.DB, 'UPDATE email_telegram_deliveries SET delivered_at = ? WHERE message_id = ? AND connection_id = ?', now(), row.id, delivery.connection_id).run();
  }
}

export async function consumeEmails(batch, env) {
  for (const message of batch.messages) {
    const messageId = message.body?.messageId;
    if (message.body?.kind !== 'EMAIL_MESSAGE' || typeof messageId !== 'string') { message.ack(); continue; }
    const lease = id('emailwork');
    const row = await stmt(env.DB, `UPDATE email_messages SET lease_token = ?, lease_until = ?, enqueued_at = NULL
      WHERE id = ? AND notified_at IS NULL AND (lease_until IS NULL OR lease_until < ?) RETURNING *`,
    lease, new Date(Date.now() + 180000).toISOString(), messageId, now()).first();
    if (!row) { message.ack(); continue; }
    try {
      const mailbox = await mailboxFor(env, row.org_id);
      const attachments = await attachmentRows(env, row), invoices = [];
      if (!mailbox?.enabled) { row.state = 'FAILED'; row.error_code = 'EMAIL_DISABLED'; }
      else if (row.state !== 'FAILED') {
        for (const a of attachments) {
          let invoiceId = a.invoice_id;
          if (!invoiceId) {
            const object = await env.INVOICES.get(a.file_key);
            if (!object) throw new HttpError(409, 'EMAIL_DOCUMENT_UNAVAILABLE');
            const bytes = await readBytes(new Response(object.body), MAX_INVOICE_BYTES);
            if (await sha256(bytes) !== a.sha256) throw new HttpError(409, 'EMAIL_DOCUMENT_INTEGRITY');
            if (!(await mailboxFor(env, row.org_id))?.enabled) throw new HttpError(409, 'EMAIL_DISABLED');
            const request = new Request(new URL('/api/v1/invoices', env.PUBLIC_APP_URL), { method: 'POST', headers: { 'Idempotency-Key': a.operation_key } });
            const response = await receiveInvoice(request, env, { user: { id: mailbox.user_id }, organization: { id: row.org_id } },
              new File([bytes], a.file_name, { type: a.mime_type }), { kind: 'EMAIL', attachmentId: a.id });
            invoiceId = (await response.json()).data.id;
          }
          invoices.push(await getInvoice(env.DB, row.org_id, invoiceId));
        }
        row.state = !attachments.length ? 'NO_DOCUMENT' : invoices.every(i => ['DECIDED','FAILED'].includes(i.status) && !i.processingError?.retryable) ? 'COMPLETED' : 'WAITING';
      }
      await stmt(env.DB, 'UPDATE email_messages SET state = ?, error_code = ? WHERE id = ? AND lease_token = ?', row.state, row.error_code, row.id, lease).run();
      if (row.state === 'WAITING') {
        await stmt(env.DB, 'UPDATE email_messages SET lease_token = NULL, lease_until = NULL, next_attempt_at = ? WHERE id = ? AND lease_token = ?',
          new Date(Date.now() + 10000).toISOString(), row.id, lease).run();
        // Durable scheduler polls the independent invoice jobs; waiting never spends another extraction attempt.
        message.ack(); continue;
      }
      if (mailbox?.enabled) await notifyTelegram(env, row, invoices, lease);
      for (const a of attachments) await env.INVOICES.delete(a.file_key);
      await stmt(env.DB, 'UPDATE email_messages SET notified_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?', now(), row.id, lease).run();
      message.ack();
    } catch (error) {
      const permanent = error instanceof HttpError && error.status < 500;
      await stmt(env.DB, `UPDATE email_messages SET state = CASE WHEN ? THEN 'FAILED' ELSE state END,
        error_code = ?, lease_token = NULL, lease_until = NULL, next_attempt_at = ? WHERE id = ? AND lease_token = ?`,
      Number(permanent), permanent ? 'EMAIL_DOCUMENT_UNAVAILABLE' : 'EMAIL_PROCESSING_DEFERRED', new Date(Date.now() + 30000).toISOString(), row.id, lease).run();
      console.error(JSON.stringify({ event: 'email_processing_deferred', messageId: row.id, permanent }));
      message.ack(); // The receipt remains recoverable even if queue delivery is exhausted.
    }
  }
}

export async function inbox(env, session) {
  const rows = (await stmt(env.DB, `SELECT e.*, r.read_at FROM email_messages e LEFT JOIN email_inbox_reads r
    ON r.org_id = e.org_id AND r.message_id = e.id AND r.user_id = ? WHERE e.org_id = ? ORDER BY e.received_at DESC,e.id DESC LIMIT 50`,
  session.user.id, session.organization.id).all()).results;
  const attachments = rows.length ? (await stmt(env.DB, `SELECT a.id,a.message_id,a.file_name,s.invoice_id,i.status,
    i.processing_error_json,d.evidence_json FROM email_attachments a
    LEFT JOIN email_invoice_sources s ON s.org_id = a.org_id AND s.attachment_id = a.id
    LEFT JOIN invoices i ON i.org_id = s.org_id AND i.id = s.invoice_id
    LEFT JOIN decisions d ON d.id = (SELECT id FROM decisions WHERE org_id = i.org_id AND invoice_id = i.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
    WHERE a.org_id = ? AND a.message_id IN (${rows.map(() => '?').join(',')}) ORDER BY a.position`, session.organization.id, ...rows.map(r => r.id)).all()).results : [];
  const messages = rows.map(row => ({ id: row.id, sender: row.sender, subject: row.subject, receivedAt: row.received_at,
    state: row.state, readAt: row.read_at, summary: summaryFor(row), attachments: attachments.filter(a => a.message_id === row.id).map(a => {
      const decision = a.evidence_json ? JSON.parse(a.evidence_json).decision : null;
      return { id: a.id, name: a.file_name, invoiceId: a.invoice_id, status: a.status, decision: decision?.action ?? null,
        explanation: decision?.humanExplanation ?? (a.processing_error_json ? JSON.parse(a.processing_error_json).message : null) };
    }) }));
  const unreadCount = await stmt(env.DB, `SELECT count(*) AS n FROM email_messages e WHERE e.org_id = ?
    AND NOT EXISTS(SELECT 1 FROM email_inbox_reads r WHERE r.org_id = e.org_id AND r.message_id = e.id AND r.user_id = ?)`, session.organization.id, session.user.id).first('n');
  return json({ data: InboxSchema.parse({ messages, unreadCount }) });
}

export async function readInboxMessage(env, session, messageId) {
  const row = await stmt(env.DB, 'SELECT id FROM email_messages WHERE org_id = ? AND id = ?', session.organization.id, messageId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  await stmt(env.DB, `INSERT INTO email_inbox_reads(org_id,user_id,message_id,read_at) VALUES (?,?,?,?)
    ON CONFLICT DO NOTHING`, session.organization.id, session.user.id, messageId, now()).run();
  return new Response(null, { status: 204 });
}

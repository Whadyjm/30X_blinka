import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import worker from '../worker/index.js';
import { consumeEmails, receiveEmail, recoverEmails, wakeEmailInvoices } from '../worker/email.js';
import { consumeInvoiceJobs } from '../worker/jobs.js';
import { processInvoice } from '../worker/processing.js';
import { corroboratePdfText } from '../worker/document.js';

const origin = 'https://oli.invalid';
const pdf = '%PDF-1.4\nsynthetic email fixture';
const ex = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'EMAIL-TEST-1', amountMinor: 20000,
  currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
  description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
function rawEmail({ subject = 'Factura de octubre', messageId = 'email-test-1@example.invalid', to = 'irrelevant@example.invalid',
  files = [{ name: 'factura.pdf', content: pdf }], extra = '' } = {}) {
  return `From: Proveedor <supplier@example.invalid>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${messageId}>\r\n${extra}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="oli-test"\r\n\r\n` +
    `--oli-test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAdjunto los documentos.\r\n` + files.map(f =>
      `--oli-test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(f.content).toString('base64')}\r\n`).join('') + '--oli-test--\r\n';
}

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'email' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  for (const name of [...readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => `migrations/${f}`), 'seed/demo.sql']) {
    await DB.batch(readFileSync(new URL(name, root), 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  }
  const emails = [], jobs = [], sent = [];
  let failPublish = false, failSend = false, reads = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /^https:\/\/api.telegram.org\/bot/);
    if (failSend) { failSend = false; return Response.json({ ok: false }, { status: 503 }); }
    sent.push(JSON.parse(options.body)); return Response.json({ ok: true, result: { message_id: sent.length } });
  });
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), PUBLIC_APP_URL: origin,
    EMAIL_BASE_ADDRESS: 'oli@example.invalid', EMAIL_QUEUE: { send: async p => { if (failPublish) throw new Error('queue unavailable'); emails.push(p); } },
    INVOICE_QUEUE: { send: async p => jobs.push(p) }, TELEGRAM_BOT_TOKEN: '123456:email-test-token',
    DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'test-only' };
  let headers = {};
  const api = async (route, method = 'GET', overrides = {}) => {
    const r = await worker.fetch(new Request(`${origin}/api/v1${route}`, { method, headers: { ...headers, ...overrides } }), env);
    return { status: r.status, ...(r.status === 204 ? {} : await r.json()) };
  };
  const login = async () => {
    const r = await worker.fetch(new Request(`${origin}/api/v1/session`, { method: 'POST', headers: { Origin: origin },
      body: JSON.stringify({ email: 'owner@oli-demo.invalid', password: env.DEMO_PASSWORD }) }), env);
    assert.equal(r.status, 200); const data = (await r.json()).data;
    headers = { Origin: origin, Cookie: r.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': data.csrfToken };
  };
  await login();
  await DB.prepare(`INSERT INTO telegram_connections(id,org_id,user_id,telegram_user_id,chat_id,display_name,connected_at)
    VALUES ('tg_email','org_demo','user_demo_owner','101','101','Oscar',?)`).bind(new Date().toISOString()).run();
  const enable = async () => { const r = await api('/integrations/email', 'POST'); assert.equal(r.status, 200); return r.data.mailbox.address; };
  const receive = async (address, raw = rawEmail(), overrides = {}) => {
    let rejected = null;
    await receiveEmail({ to: address, from: 'supplier@example.invalid', raw: new Blob([raw]).stream(), rawSize: Buffer.byteLength(raw),
      setReject: value => { rejected = value; }, ...overrides }, env);
    return rejected;
  };
  const batch = list => ({ messages: list.map(body => ({ body, attempts: 1, ack() {}, retry() { assert.fail('durable recovery handles retries'); } })) });
  const drainEmails = () => consumeEmails(batch(emails.splice(0)), env);
  const drainJobs = async (kind = 'INVOICE', corroborated = true) => {
    const b = batch(jobs.splice(0));
    await consumeInvoiceJobs(b, env, (e,o,i) => processInvoice(e,o,i, async (_env,_file,_bytes,hash) => {
      reads++;
      return { extraction: ex, documentType: kind, primaryReadId: 'primary', documentSha256: hash,
        corroboration: corroborated ? corroboratePdfText(`EMISOR / SUPPLIER\n${ex.vendorName}\nMoneda / Currency\nUSD\nVencimiento / Due\n${ex.dueDate}\nTOTAL A COBRAR\nUSD 200.00`, hash) : null };
    }));
    await wakeEmailInvoices(b, env);
  };
  return { env, DB, api, login, enable, receive, emails, jobs, sent, drainEmails, drainJobs,
    get reads() { return reads; }, failPublish: value => { failPublish = value; }, failNextSend: () => { failSend = true; } };
}

test('Email: OWNER provisiona dirección estable, auth/CSRF y pausa rechazan ingreso no autorizado', async t => {
  const s = await setup(t);
  assert.equal((await s.api('/integrations/email', 'POST', { Cookie: '' })).status, 401);
  assert.equal((await s.api('/integrations/email', 'POST', { 'X-CSRF-Token': '' })).status, 403);
  const address = await s.enable(); assert.match(address, /^oli\+[a-f0-9]{32}@example.invalid$/);
  assert.equal(await s.enable(), address);
  assert.ok(await s.receive('unknown@example.invalid'));
  await s.api('/integrations/email', 'DELETE'); assert.ok(await s.receive(address));
  assert.equal(await s.enable(), address);
  await s.DB.prepare("UPDATE memberships SET role = 'APPROVER' WHERE user_id = 'user_demo_owner'").run();
  assert.equal((await s.api('/integrations/email', 'DELETE')).status, 403);
  assert.equal((await s.api('/integrations/email', 'POST')).status, 403);
});

test('Email: MIME→inbox inmediato→pipeline existente→Telegram, origen EMAIL y contexto privado', async t => {
  const s = await setup(t), address = await s.enable();
  assert.equal(await s.receive(address), null);
  let inbox = (await s.api('/inbox')).data;
  assert.equal(inbox.unreadCount, 1); assert.equal(inbox.messages[0].state, 'RECEIVED');
  assert.equal(inbox.messages[0].subject, 'Factura de octubre');
  await s.drainEmails(); assert.equal(s.sent.length, 0);
  assert.equal((await s.api('/inbox')).data.messages[0].state, 'WAITING');
  await s.drainJobs(); await s.drainEmails();
  inbox = (await s.api('/inbox')).data;
  assert.equal(inbox.messages[0].state, 'COMPLETED');
  const a = inbox.messages[0].attachments[0]; assert.equal(a.decision, 'APPROVE');
  assert.equal((await s.api(`/invoices/${a.invoiceId}`)).data.source, 'EMAIL');
  assert.equal(s.reads, 1); assert.match(s.sent.at(-1).text, /Factura de octubre/);
  assert.match(s.sent.at(-1).text, /200.00 USD/); assert.match(s.sent.at(-1).text, /\/app\/inbox/);
  assert.equal(await s.DB.prepare('SELECT last_invoice_id FROM telegram_conversations WHERE connection_id = ?').bind('tg_email').first('last_invoice_id'), a.invoiceId);
  assert.equal((await s.api(`/inbox/${inbox.messages[0].id}/read`, 'POST')).status, 204);
  assert.equal((await s.api('/inbox')).data.unreadCount, 0);
  assert.equal((await s.env.INVOICES.list({ prefix: 'email/' })).objects.length, 0);
  assert.equal(await s.DB.prepare("SELECT actor_kind FROM audit_events WHERE type = 'INVOICE_RECEIVED'").first('actor_kind'), 'SYSTEM');
});

test('Email: reentrega SMTP con cambios de transporte y duplicados de cola no duplican recibo, decisión, reserva ni aviso', async t => {
  const s = await setup(t), address = await s.enable();
  await Promise.all([s.receive(address), s.receive(address, rawEmail({ extra: 'Received: retry transport\r\n' }))]);
  await s.drainEmails(); await s.drainJobs(); await s.drainEmails();
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM email_messages').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM invoices').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM decisions').first('n'), 1);
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 1);
  assert.equal(s.sent.length, 1);
  await s.receive(address); await s.drainEmails();
  assert.equal(s.reads, 1); assert.equal(s.sent.length, 1);
});

test('Email: el mismo PDF en otro correo crea entrada auditable y se bloquea como duplicado', async t => {
  const s = await setup(t), address = await s.enable();
  await s.receive(address); await s.drainEmails(); await s.drainJobs(); await s.drainEmails();
  await s.receive(address, rawEmail({ messageId: 'another-email@example.invalid' }));
  await s.drainEmails(); await s.drainJobs(); await s.drainEmails();
  const inbox = (await s.api('/inbox')).data;
  assert.equal(inbox.messages.length, 2);
  assert.ok(inbox.messages.some(m => m.attachments[0].decision === 'BLOCK'));
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 1);
});

test('Email: scheduler recupera publicación y fallo de Telegram sin reextraer; revocar impide respuesta privada pendiente', async t => {
  const s = await setup(t), address = await s.enable();
  s.failPublish(true); await s.receive(address); assert.equal(s.emails.length, 0);
  s.failPublish(false); await recoverEmails(s.env); await s.drainEmails(); await s.drainJobs();
  s.failNextSend(); await s.drainEmails(); assert.equal(s.sent.length, 0);
  await s.DB.prepare("UPDATE telegram_connections SET revoked_at = ? WHERE id = 'tg_email'").bind(new Date().toISOString()).run();
  await s.DB.prepare("UPDATE email_messages SET next_attempt_at = '2000-01-01T00:00:00.000Z',enqueued_at = NULL").run();
  await recoverEmails(s.env); await s.drainEmails();
  assert.equal(s.reads, 1); assert.equal(s.sent.length, 0);
  assert.ok(await s.DB.prepare('SELECT notified_at FROM email_messages').first('notified_at'));
});

test('Email: imágenes pegadas en Gmail llegan a inbox y Telegram sin autoaprobar lecturas inciertas ni logos', async t => {
  for (const [mime, bytes, kind, expected] of [
    ['image/png', [137,80,78,71,13,10,26,10,0], 'INVOICE', 'ESCALATE'],
    ['image/jpeg', [255,216,255,0], 'OTHER', 'BLOCK'],
  ]) {
    const s = await setup(t), address = await s.enable();
    const raw = [
      'From: supplier@example.invalid', `To: ${address}`, 'Subject: Factura pegada en el cuerpo',
      'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="gmail-body"', '',
      '--gmail-body', 'Content-Type: multipart/alternative; boundary="gmail-text"', '',
      '--gmail-text', 'Content-Type: text/plain; charset=utf-8', '', 'Factura en imagen.',
      '--gmail-text', 'Content-Type: text/html; charset=utf-8', '',
      '<div><img src="cid:invoice-body"><img src="https://remote.invalid/tracking.png"></div>',
      '--gmail-text--', '', '--gmail-body', `Content-Type: ${mime}; name="image.png"`,
      'Content-Disposition: inline; filename="image.png"', 'Content-ID: <invoice-body>',
      'X-Attachment-Id: invoice-body', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(bytes).toString('base64'), '--gmail-body--', '',
    ].join('\r\n');
    assert.equal(await s.receive(address, raw), null);
    const received = (await s.api('/inbox')).data.messages[0];
    assert.equal(received.state, 'RECEIVED'); assert.equal(received.attachments.length, 1);
    await s.drainEmails(); await s.drainJobs(kind, false); await s.drainEmails();
    const message = (await s.api('/inbox')).data.messages[0];
    assert.equal(message.state, 'COMPLETED'); assert.equal(message.attachments[0].decision, expected);
    const invoice = (await s.api(`/invoices/${message.attachments[0].invoiceId}`)).data;
    assert.equal(invoice.source, 'EMAIL'); assert.equal(invoice.file.mimeType, mime);
    assert.equal(await s.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
    assert.equal(s.reads, 1); assert.equal(s.sent.length, 1);
    assert.match(s.sent[0].text, /Factura pegada en el cuerpo/);
  }
});

test('Email: sin adjuntos o documentos ajenos no autoriza; límites rechazan antes de extraer', async t => {
  const s = await setup(t), address = await s.enable();
  assert.ok(await s.receive(address, '', { rawSize: 12 * 1024 * 1024 + 1 }));
  assert.ok(await s.receive(address, rawEmail({ files: Array.from({ length: 5 }, () => ({ name: 'factura.pdf', content: pdf })) })));
  assert.ok(await s.receive(address, rawEmail({ files: [{ name: 'grande.pdf', content: pdf + 'x'.repeat(5 * 1024 * 1024) }] })));
  await s.receive(address, rawEmail({ files: [] })); await s.drainEmails();
  assert.equal((await s.api('/inbox')).data.messages[0].state, 'NO_DOCUMENT'); assert.equal(s.reads, 0);
  await s.receive(address); await s.drainEmails(); await s.drainJobs('PAYMENT_RECEIPT'); await s.drainEmails();
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
  assert.ok((await s.api('/inbox')).data.messages.some(m => m.attachments[0]?.decision === 'BLOCK'));
});

test('Email: empresa viene de destinatario SMTP, To no cambia permisos y lectura de inbox es privada', async t => {
  const s = await setup(t), address = await s.enable();
  await s.receive(address, rawEmail({ to: 'other-company@example.invalid', subject: '<script>org_id=other</script>' }));
  const initial = (await s.api('/inbox')).data;
  await s.DB.batch([
    s.DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('other','Otra empresa','USD','UTC')"),
    s.DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('other','user_demo_owner','OWNER')"),
  ]);
  s.env.DEMO_ORG_ID = 'other'; await s.login();
  assert.equal((await s.api('/inbox')).data.messages.length, 0);
  assert.equal((await s.api(`/inbox/${initial.messages[0].id}/read`, 'POST')).status, 404);
  assert.notEqual(await s.enable(), address);
  await s.drainEmails(); await s.drainJobs(); await s.drainEmails();
  assert.equal(s.sent.at(-1).chat_id, '101');
  assert.equal(await s.DB.prepare("SELECT count(*) n FROM invoices WHERE org_id = 'other'").first('n'), 0);
});

test('Email: pausar durante escritura R2 impide ingreso mediante guard atómico D1', async t => {
  const s = await setup(t), address = await s.enable();
  await s.receive(address);
  const bucket = s.env.INVOICES;
  s.env.INVOICES = {
    get: key => bucket.get(key), delete: key => bucket.delete(key),
    put: async (...args) => {
      await s.DB.prepare('UPDATE email_mailboxes SET enabled = 0').run();
      return bucket.put(...args);
    },
  };
  await s.drainEmails();
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM invoices').first('n'), 0);
  assert.equal((await bucket.list({ prefix: 'uploads/' })).objects.length, 0);
  assert.equal(s.jobs.length, 0); assert.equal(s.sent.length, 0);
});

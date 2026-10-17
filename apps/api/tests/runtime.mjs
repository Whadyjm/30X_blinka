import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare, createFetchMock } from 'miniflare';

async function mockBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

test('Worker empaquetado en workerd: sesión, R2, OpenRouter simulado, motor y D1', async t => {
  const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
  const extraction = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'RUNTIME-1', amountMinor: 20000,
    currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
    description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, { model: 'test-vision', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...extraction, documentType: 'INVOICE' }) } }] });
  // This harness exists only in the ignored test output; production exposes no HTTP email-ingest bypass.
  const harness = new URL('../.wrangler/runtime/email-harness.js', import.meta.url);
  writeFileSync(harness, `import app from './index.js';
    export default { ...app, async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === '/__test_email') {
        let rejected = null;
        await app.email({ from: request.headers.get('X-Email-From'), to: request.headers.get('X-Email-To'),
          raw: request.body, rawSize: Number(request.headers.get('Content-Length')),
          setReject(reason) { rejected = reason; } }, env, ctx);
        return Response.json({ rejected });
      }
      return app.fetch(request, env, ctx);
    } };`);
  const runtime = new Miniflare({ modules: true, scriptPath: harness.pathname,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'runtime' }, r2Buckets: ['INVOICES'], fetchMock,
    queueProducers: { TELEGRAM_QUEUE: 'oli-telegram', INVOICE_QUEUE: 'oli-invoices', EMAIL_QUEUE: 'oli-email' },
    queueConsumers: { 'oli-invoices': { maxBatchSize: 1, maxBatchTimeout: 0.1, maxRetries: 3 },
      'oli-telegram': { maxBatchSize: 1, maxBatchTimeout: 0.1, maxRetries: 5 },
      'oli-email': { maxBatchSize: 1, maxBatchTimeout: 0.1, maxRetries: 5 } },
    bindings: { DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner', DEMO_PASSWORD: 'test-only', OPENROUTER_API_KEY: 'test-only',
      PUBLIC_APP_URL: 'https://oli.invalid', EMAIL_BASE_ADDRESS: 'oli@example.invalid', TELEGRAM_BOT_TOKEN: '123456:runtime-test-token', TELEGRAM_WEBHOOK_SECRET: 'runtime-webhook-secret' } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const file of files) await db.batch(readFileSync(file, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => db.prepare(s)));
  const origin = 'https://oli.invalid';
  const login = await runtime.dispatchFetch(`${origin}/api/v1/session`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@oli-demo.invalid', password: 'test-only' }) });
  assert.equal(login.status, 200); const session = (await login.json()).data;
  const headers = { Origin: origin, Cookie: login.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
  fetchMock.get('https://api.telegram.org').intercept({ path: '/bot123456:runtime-test-token/getMe', method: 'POST' })
    .reply(200, { ok: true, result: { username: 'OliRuntimeBot' } });
  fetchMock.get('https://api.telegram.org').intercept({ path: '/bot123456:runtime-test-token/setWebhook', method: 'POST' })
    .reply(200, { ok: true, result: true });
  const telegram = await runtime.dispatchFetch(`${origin}/api/v1/integrations/telegram/link`, { method: 'POST', headers });
  const linked = await telegram.json();
  assert.equal(telegram.status, 201, JSON.stringify(linked));
  assert.match(linked.data.url, /^https:\/\/t.me\/OliRuntimeBot\?start=/);
  const form = new FormData(); form.append('file', new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' }), 'synthetic.png');
  // Serialize Node's native FormData before crossing Miniflare's Undici boundary.
  const multipart = new Request(`${origin}/api/v1/invoices`, { method: 'POST', body: form });
  const upload = await runtime.dispatchFetch(`${origin}/api/v1/invoices`, { method: 'POST', body: new Uint8Array(await multipart.arrayBuffer()),
    headers: { ...headers, 'Content-Type': multipart.headers.get('Content-Type'), 'Idempotency-Key': crypto.randomUUID() } });
  const uploaded = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploaded)); const invoice = uploaded.data;
  const process = await runtime.dispatchFetch(`${origin}/api/v1/invoices/${invoice.id}/process`, { method: 'POST', headers });
  assert.ok([200, 202].includes(process.status));
  let detail = (await process.json()).data;
  for (let poll = 0; poll < 50 && detail.status !== 'DECIDED'; poll++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    detail = (await (await runtime.dispatchFetch(`${origin}/api/v1/invoices/${invoice.id}`, { headers })).json()).data;
  }
  assert.equal(detail.status, 'DECIDED'); assert.equal(detail.latestDecision.action, 'ESCALATE');
  assert.equal(detail.approvalRequest, null); assert.equal(detail.decisions.length, 1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'), 0);
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: 'runtime-budget', type: 'function', function: { name: 'get_budget', arguments: JSON.stringify({ period: 'CURRENT_MONTH' }) } },
    ] } }] });
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ finish_reason: 'stop', message: { content: 'Este es el presupuesto registrado.' } }] });
  const chat = await runtime.dispatchFetch(`${origin}/api/v1/chat/messages`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ conversationId: null, text: '¿Cómo va mi presupuesto?', invoiceIds: [] }) });
  const reply = await chat.json(); assert.equal(chat.status, 200, JSON.stringify(reply));
  assert.equal(reply.data.cards[0].type, 'BUDGET');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM chat_turns WHERE state = ?').bind('COMPLETED').first('n'), 1);
  assert.equal(await db.prepare('SELECT state FROM invoice_jobs WHERE invoice_id = ?').bind(invoice.id).first('state'), 'DONE');
  const replay = await runtime.dispatchFetch(`${origin}/api/v1/invoices/${invoice.id}/process`, { method: 'POST', headers });
  assert.equal(replay.status, 200);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM decisions WHERE invoice_id = ?').bind(invoice.id).first('n'), 1);
  const sent = [];
  fetchMock.get('https://api.telegram.org').intercept({ path: '/bot123456:runtime-test-token/sendMessage', method: 'POST' })
    .reply(200, async options => { sent.push(await mockBody(options.body)); return { ok: true, result: { message_id: sent.length } }; }).times(3);
  const webhook = text => runtime.dispatchFetch(`${origin}/api/channels/telegram/webhook`, { method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'runtime-webhook-secret' },
    body: JSON.stringify({ update_id: sent.length + 100, message: { text, from: { id: 101, is_bot: false, first_name: 'Oscar' }, chat: { id: 101, type: 'private' } } }) });
  const waitForReply = async count => {
    for (let poll = 0; poll < 100 && sent.length < count; poll++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(sent.length, count);
  };
  assert.equal((await webhook(`/start ${new URL(linked.data.url).searchParams.get('start')}`)).status, 200);
  await waitForReply(1);
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, async options => {
      const messages = (await mockBody(options.body)).messages;
      assert.match(messages[0].content, /Estás en Telegram/);
      assert.equal(JSON.parse(messages.at(-1).content).message, 'hola');
      return { choices: [{ finish_reason: 'stop', message: { content: '¡Hola! Podemos revisar tu presupuesto.' } }] };
    });
  assert.equal((await webhook('hola')).status, 200);
  await waitForReply(2);
  assert.match(sent.at(-1).text, /¡Hola!/);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM chat_turns WHERE state = ?').bind('COMPLETED').first('n'), 2);
  const webThreads = (await (await runtime.dispatchFetch(`${origin}/api/v1/chat/conversations`, { headers })).json()).data;
  const telegramThreads = (await (await runtime.dispatchFetch(`${origin}/api/v1/chat/conversations?channel=TELEGRAM`, { headers })).json()).data;
  assert.equal(webThreads.length, 1); assert.equal(webThreads[0].channel, 'WEB');
  assert.equal(telegramThreads.length, 1); assert.equal(telegramThreads[0].channel, 'TELEGRAM');
  assert.notEqual(webThreads[0].id, telegramThreads[0].id);
  const telegramHistory = (await (await runtime.dispatchFetch(`${origin}/api/v1/chat/conversations/${telegramThreads[0].id}`, { headers })).json()).data;
  assert.equal(telegramHistory.channel, 'TELEGRAM'); assert.equal(telegramHistory.turns.length, 1);
  assert.equal(telegramHistory.turns[0].text, 'hola');
  const wrongChannel = await runtime.dispatchFetch(`${origin}/api/v1/chat/messages`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ conversationId: telegramThreads[0].id, text: 'no mezclar', invoiceIds: [] }) });
  assert.equal(wrongChannel.status, 409); assert.equal((await wrongChannel.json()).error.code, 'CHAT_CHANNEL_MISMATCH');
  const reevaluate = (current, key) => runtime.dispatchFetch(`${origin}/api/v1/invoices/${invoice.id}/reevaluate`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ expectedDecisionId: current.latestDecision.id, expectedPolicyVersionId: current.latestDecision.policyVersionId }),
  });
  const reanalysisKey = crypto.randomUUID();
  const updated = await reevaluate(detail, reanalysisKey);
  const result = await updated.json(); assert.equal(updated.status, 200, JSON.stringify(result));
  const limited = await reevaluate(result.data, crypto.randomUUID());
  assert.equal(limited.status, 429); assert.equal((await limited.json()).error.code, 'REANALYSIS_COOLDOWN');
  assert.ok(Number(limited.headers.get('Retry-After')) > 0 && Number(limited.headers.get('Retry-After')) <= 60);
  assert.deepEqual((await (await reevaluate(detail, reanalysisKey)).json()).data, result.data);
  assert.equal(await db.prepare('SELECT count(*) n FROM decisions WHERE invoice_id=?').bind(invoice.id).first('n'), 2);
  assert.equal(await db.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
  const mailbox = await runtime.dispatchFetch(`${origin}/api/v1/integrations/email`, { method: 'POST', headers });
  assert.equal(mailbox.status, 200); const address = (await mailbox.json()).data.mailbox.address;
  fetchMock.get('https://openrouter.ai').intercept({ path: '/api/v1/chat/completions', method: 'POST' })
    .reply(200, { model: 'test-vision', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...extraction, invoiceNumber: 'RUNTIME-EMAIL', documentType: 'INVOICE' }) } }] });
  const raw = `From: supplier@example.invalid\r\nTo: ${address}\r\nSubject: Factura runtime email\r\nMessage-ID: <runtime-email@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=oli\r\n\r\n--oli\r\nContent-Type: text/html\r\n\r\n<div><img src="cid:invoice-body"></div>\r\n--oli\r\nContent-Type: image/png\r\nContent-Disposition: inline; filename=factura.png\r\nContent-ID: <invoice-body>\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}\r\n--oli--\r\n`;
  const incoming = await runtime.dispatchFetch(`${origin}/__test_email`, { method: 'POST', body: raw,
    headers: { 'X-Email-From': 'supplier@example.invalid', 'X-Email-To': address } });
  assert.equal((await incoming.json()).rejected, null);
  let received;
  for (let poll = 0; poll < 100; poll++) {
    const current = (await (await runtime.dispatchFetch(`${origin}/api/v1/inbox`, { headers })).json()).data;
    received = current.messages[0];
    if (received?.attachments[0]?.status === 'DECIDED') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(received?.attachments[0]?.status, 'DECIDED');
  const emailInvoice = (await (await runtime.dispatchFetch(`${origin}/api/v1/invoices/${received.attachments[0].invoiceId}`, { headers })).json()).data;
  assert.equal(emailInvoice.source, 'EMAIL'); assert.equal(emailInvoice.file.mimeType, 'image/png');
  assert.equal(emailInvoice.latestDecision.action, 'ESCALATE');
  // Force a duplicate delivery to also cover the scheduler's fallback when jobs finish inside the receipt lease.
  await (await runtime.getQueueProducer('EMAIL_QUEUE')).send({ kind: 'EMAIL_MESSAGE', messageId: received.id });
  await waitForReply(3);
  assert.match(sent.at(-1).text, /Me llegó por correo/);
  assert.match(sent.at(-1).text, /Necesito que la revises/);
  assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].url, `${origin}/app/bills/${emailInvoice.id}`);
  assert.deepEqual(sent.at(-1).link_preview_options, { is_disabled: true });
  const inbox = (await (await runtime.dispatchFetch(`${origin}/api/v1/inbox`, { headers })).json()).data;
  assert.equal(inbox.unreadCount, 1);
  assert.equal(await db.prepare('SELECT count(*) n FROM budget_reservations').first('n'), 0);
  fetchMock.assertNoPendingInterceptors();
});

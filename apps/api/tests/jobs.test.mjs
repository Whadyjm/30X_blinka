import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { consumeInvoiceJobs, enqueueInvoice, getReadArtifact, putReadArtifact, recoverInvoiceJobs } from '../worker/jobs.js';
import { processInvoice } from '../worker/processing.js';
import { getInvoice } from '../worker/repository.js';
import { HttpError, id, now, sha256, stmt } from '../worker/http.js';

const ex = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'JOBS-TEST-1', amountMinor: 20000,
  currency: 'USD', issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10',
  description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };

async function setup(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'jobs' }, r2Buckets: ['INVOICES'] });
  t.after(() => runtime.dispose());
  const DB = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  const files = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
  files.push(new URL('seed/demo.sql', root));
  for (const path of files) await DB.batch(readFileSync(path, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  const queue = [];
  const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), INVOICE_QUEUE: { send: async body => queue.push(body) } };
  const upload = async () => {
    const invoiceId = id('inv');
    const bytes = new TextEncoder().encode(`%PDF-1.4\nsynthetic queued fixture ${invoiceId}`);
    const hash = await sha256(bytes); const key = `test/${invoiceId}`;
    await env.INVOICES.put(key, bytes);
    await stmt(DB, `INSERT INTO invoices(id,org_id,file_key,file_name,file_mime_type,file_size_bytes,file_sha256)
      VALUES (?, 'org_demo', ?, 'test.pdf', 'application/pdf', ?, ?)`, invoiceId, key, bytes.length, hash).run();
    return getInvoice(DB, 'org_demo', invoiceId);
  };
  const message = body => {
    const value = { body, acks: 0, retries: [], ack() { this.acks++; }, retry(options) { this.retries.push(options); } };
    return value;
  };
  const job = invoice => stmt(DB, 'SELECT * FROM invoice_jobs WHERE invoice_id = ?', invoice.id).first();
  const due = invoice => stmt(DB, "UPDATE invoice_jobs SET next_attempt_at = '2000-01-01T00:00:00.000Z', enqueued_at = NULL WHERE invoice_id = ?", invoice.id).run();
  const ledger = async () => ({ decisions: await DB.prepare('SELECT count(*) n FROM decisions').first('n'),
    reservations: await DB.prepare('SELECT count(*) n FROM budget_reservations').first('n'),
    reserved: await DB.prepare('SELECT sum(reserved_minor) n FROM budget_periods').first('n') });
  const read = async (_env, _file, _bytes, documentSha256) => ({
    extraction: ex, documentType: 'INVOICE', primaryReadId: 'synthetic-primary', documentSha256,
    corroboration: { documentSha256, readId: 'synthetic-secondary', method: 'PDF_TEXT',
      fields: { vendorName: ex.vendorName, amountMinor: ex.amountMinor, currency: ex.currency, dueDate: ex.dueDate } },
  });
  const processing = (e, org, invoice) => processInvoice(e, org, invoice, read);
  return { env, DB, upload, queue, job, due, message, processing, ledger, read };
}

test('Jobs: trigger crea intento durable y cron recupera upload sin publicación y fallo del productor', async t => {
  const s = await setup(t); const invoice = await s.upload();
  assert.equal((await s.job(invoice)).state, 'PENDING');
  assert.equal(await s.DB.prepare('SELECT count(*) n FROM invoice_job_events').first('n'), 1);
  s.env.INVOICE_QUEUE.send = async () => { throw new Error('private-key must not leak'); };
  assert.equal((await enqueueInvoice(s.env, 'org_demo', invoice.id)).status, 202);
  assert.equal((await s.job(invoice)).enqueued_at, null);
  s.env.INVOICE_QUEUE.send = async body => s.queue.push(body);
  assert.deepEqual(await recoverInvoiceJobs(s.env), { expired: 0, dispatched: 1 });
  assert.deepEqual(s.queue[0], { kind: 'INVOICE_JOB', jobId: (await s.job(invoice)).id });
  assert.equal((await recoverInvoiceJobs(s.env)).dispatched, 0);
  assert.deepEqual(await s.ledger(), { decisions: 0, reservations: 0, reserved: 0 });
  await assert.rejects(enqueueInvoice(s.env, 'other', invoice.id), /NOT_FOUND/);
});

test('Jobs: duplicados concurrentes y replay después de commit no repiten lectura ni reserva', async t => {
  const s = await setup(t); const invoice = await s.upload();
  await enqueueInvoice(s.env, 'org_demo', invoice.id);
  const first = s.message(s.queue[0]), duplicate = s.message(s.queue[0]);
  let reads = 0; let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pending = consumeInvoiceJobs({ messages: [first] }, s.env, async (...args) => {
    reads++; started(); await gate; return s.processing(...args);
  });
  await entered;
  await consumeInvoiceJobs({ messages: [duplicate] }, s.env, () => assert.fail('No debe duplicar el procesador'));
  assert.equal(duplicate.acks, 0); assert.equal(duplicate.retries.length, 1);
  release(); await pending;
  assert.equal(first.acks, 1); assert.equal((await s.job(invoice)).state, 'DONE'); assert.equal(reads, 1);
  const replay = s.message(s.queue[0]);
  await consumeInvoiceJobs({ messages: [replay] }, s.env, () => assert.fail('No vuelve a leer después del commit'));
  assert.equal(replay.acks, 1);
  assert.deepEqual(await s.ledger(), { decisions: 1, reservations: 1, reserved: 20000 });
  assert.equal((await enqueueInvoice(s.env, 'org_demo', invoice.id)).status, 200);
});

test('Jobs: lease abandonado recupera estado, backoff y tres intentos quedan terminales y auditables', async t => {
  const s = await setup(t); const invoice = await s.upload(); const j = await s.job(invoice);
  await stmt(s.DB, `UPDATE invoice_jobs SET state='RUNNING',attempts=1,lease_token='crashed',lease_until='2000-01-01T00:00:00.000Z',next_attempt_at=NULL WHERE id=?`, j.id).run();
  await stmt(s.DB, `UPDATE invoices SET status='PARSING',processing_token='abandoned',processing_started_at='2000-01-01T00:00:00.000Z' WHERE id=?`, invoice.id).run();
  assert.equal((await recoverInvoiceJobs(s.env)).expired, 1);
  assert.equal((await s.job(invoice)).state, 'RETRY');
  assert.equal((await getInvoice(s.DB, 'org_demo', invoice.id)).status, 'RECEIVED');
  assert.equal(s.queue.length, 0, 'se respeta el backoff');
  await enqueueInvoice(s.env, 'org_demo', invoice.id, { retry: true }); assert.equal(s.queue.length, 0);
  for (let attempt = 2; attempt <= 3; attempt++) {
    await s.due(invoice); await recoverInvoiceJobs(s.env);
    const msg = s.message(s.queue.shift());
    await consumeInvoiceJobs({ messages: [msg] }, s.env, async () => { throw new Error('private-key text'); });
    assert.equal(msg.acks, 1); assert.equal((await s.job(invoice)).attempts, attempt);
    assert.equal((await s.job(invoice)).state, attempt === 3 ? 'DEAD' : 'RETRY');
  }
  const failed = await getInvoice(s.DB, 'org_demo', invoice.id);
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.processingError.retryable, false);
  assert.equal(failed.processingError.code, 'JOB_RETRIES_EXHAUSTED');
  assert.equal((await enqueueInvoice(s.env, 'org_demo', invoice.id, { retry: true })).status, 200);
  assert.equal((await recoverInvoiceJobs(s.env)).dispatched, 0);
  assert.equal((await s.job(invoice)).attempts, 3);
  const history = (await s.DB.prepare('SELECT * FROM invoice_job_events ORDER BY sequence').all()).results;
  assert.equal(history.at(-1).state, 'DEAD'); assert.equal(JSON.stringify(history).includes('private-key'), false);
  await assert.rejects(s.DB.prepare('DELETE FROM invoice_job_events').run(), /JOB_HISTORY_IMMUTABLE/);
  await assert.rejects(s.DB.prepare("UPDATE invoice_jobs SET attempts=0").run(), /JOB_ATTEMPTS_IMMUTABLE/);
  await assert.rejects(s.DB.prepare("UPDATE invoice_jobs SET state='PENDING'").run(), /JOB_TERMINAL/);
  assert.deepEqual(await s.ledger(), { decisions: 0, reservations: 0, reserved: 0 });
});

test('Jobs: falla permanente termina una sola vez y mantiene FAILED para la interfaz', async t => {
  const s = await setup(t); const invoice = await s.upload(); await enqueueInvoice(s.env, 'org_demo', invoice.id);
  const msg = s.message(s.queue[0]);
  await consumeInvoiceJobs({ messages: [msg] }, s.env, async () => { throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'private document'); });
  assert.equal(msg.acks, 1); assert.equal((await s.job(invoice)).state, 'DEAD'); assert.equal((await s.job(invoice)).attempts, 1);
  assert.equal((await getInvoice(s.DB, 'org_demo', invoice.id)).processingError.retryable, false);
  await consumeInvoiceJobs({ messages: [s.message(s.queue[0])] }, s.env, () => assert.fail('No reintenta permanente'));
});

for (const typed of [true, false]) test(`Jobs: rate limit ${typed ? 'tipado' : 'opaco'} envuelto en HTTP 400 conserva lectura independiente y recupera una única reserva`, async t => {
  const s = await setup(t), invoice = await s.upload();
  let calls = 0, conversions = 0;
  s.env.OPENROUTER_API_KEY = 'private-test-only';
  s.env.AI = { toMarkdown: async () => {
    conversions++;
    return { format: 'markdown', data: `Supplier: ${ex.vendorName}\nInvoice number: ${ex.invoiceNumber}\nIssue date: ${ex.issuedAt}\nDue date: ${ex.dueDate}\nService period: ${ex.servicePeriod}\nDescription: ${ex.description}\nTotal: USD 200.00` };
  } };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (++calls <= 3) return Response.json({ error: { code: 400,
      ...(typed ? { metadata: { error_type: 'rate_limit_exceeded' } } : { message: 'Upstream temporarily rate limited; retry later' }) } }, { status: 400 });
    return Response.json({ model: JSON.parse(init.body).model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...ex, documentType: 'INVOICE' }) } }] });
  });
  await enqueueInvoice(s.env, 'org_demo', invoice.id);
  await consumeInvoiceJobs({ messages: [s.message(s.queue.shift())] }, s.env);
  assert.equal((await s.job(invoice)).state, 'RETRY');
  assert.equal((await getInvoice(s.DB, 'org_demo', invoice.id)).processingError.retryable, true);
  assert.deepEqual(await s.ledger(), { decisions: 0, reservations: 0, reserved: 0 });
  assert.equal(calls, 3); assert.equal(conversions, 1);
  await s.due(invoice); await recoverInvoiceJobs(s.env);
  const body = s.queue.shift();
  await consumeInvoiceJobs({ messages: [s.message(body)] }, s.env);
  assert.equal((await s.job(invoice)).state, 'DONE');
  assert.equal(calls, 4); assert.equal(conversions, 1, 'la conversión válida se reutiliza');
  assert.deepEqual(await s.ledger(), { decisions: 1, reservations: 1, reserved: 20000 });
  await consumeInvoiceJobs({ messages: [s.message(body)] }, s.env, () => assert.fail('replay no llama lectores'));
  assert.deepEqual(await s.ledger(), { decisions: 1, reservations: 1, reserved: 20000 });
});

test('Jobs: HTTP 400 sin indicio de saturación o con error permanente no reintenta', async t => {
  for (const issueCodes of [['HTTP_400'], ['HTTP_400', 'UPSTREAM_RATE_LIMIT', 'UNSUPPORTED_PARAMETER'],
    ['HTTP_400', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_CREDIT_LIMIT'],
    ['HTTP_400', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_POLICY_REFUSAL']]) {
    await t.test(issueCodes.join(','), async sub => {
      const s = await setup(sub), invoice = await s.upload();
      await enqueueInvoice(s.env, 'org_demo', invoice.id);
      const { ExtractionError } = await import('@oli/extraction');
      await consumeInvoiceJobs({ messages: [s.message(s.queue[0])] }, s.env, (...args) => processInvoice(...args,
        async () => { throw new ExtractionError('OPENROUTER_REQUEST_REJECTED', [], { stage: 'HTTP_ERROR', issueCodes }); }));
      assert.equal((await s.job(invoice)).state, 'DEAD');
      assert.equal((await s.job(invoice)).attempts, 1);
      assert.deepEqual(await s.ledger(), { decisions: 0, reservations: 0, reserved: 0 });
    });
  }
});

test('Jobs: commit financiero antes de crash se recupera sin duplicar decisión ni reserva', async t => {
  const s = await setup(t); const invoice = await s.upload(); const j = await s.job(invoice);
  await stmt(s.DB, `UPDATE invoice_jobs SET state='RUNNING',attempts=1,lease_token='crashed',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?`, j.id).run();
  await s.processing(s.env, 'org_demo', invoice.id);
  await recoverInvoiceJobs(s.env);
  assert.equal((await s.job(invoice)).state, 'DONE');
  const msg = s.message({ kind: 'INVOICE_JOB', jobId: j.id });
  await consumeInvoiceJobs({ messages: [msg] }, s.env, () => assert.fail('Commit ya existe'));
  assert.equal(msg.acks, 1); assert.deepEqual(await s.ledger(), { decisions: 1, reservations: 1, reserved: 20000 });
});

test('Jobs: fallo de D1 al finalizar no confirma mensaje y el lease sigue recuperable', async t => {
  const s = await setup(t); const invoice = await s.upload(); await enqueueInvoice(s.env, 'org_demo', invoice.id);
  const msg = s.message(s.queue[0]);
  const failing = { ...s.env, DB: { prepare: (...args) => s.DB.prepare(...args), batch: async () => { throw new Error('DB down'); } } };
  await consumeInvoiceJobs({ messages: [msg] }, failing, async () => { throw new Error('processing down'); });
  assert.equal(msg.acks, 0); assert.equal(msg.retries.length, 1);
  assert.equal((await s.job(invoice)).state, 'RUNNING');
});

test('Jobs: artefactos privados por empresa/hash/versión/canal, inmutables y acotados', async t => {
  const s = await setup(t); const invoice = await s.upload();
  const hash = await stmt(s.DB, 'SELECT file_sha256 FROM invoices WHERE id=?', invoice.id).first('file_sha256');
  const artifact = { extraction: ex, documentType: 'INVOICE', primaryReadId: 'primary-1' };
  assert.equal(await getReadArtifact(s.DB, 'org_demo', hash, 'v1', 'PRIMARY'), null);
  await putReadArtifact(s.DB, 'org_demo', hash, 'v1', 'PRIMARY', artifact);
  await putReadArtifact(s.DB, 'org_demo', hash, 'v1', 'PRIMARY', { forged: true });
  assert.deepEqual(await getReadArtifact(s.DB, 'org_demo', hash, 'v1', 'PRIMARY'), artifact);
  assert.equal(await getReadArtifact(s.DB, 'other', hash, 'v1', 'PRIMARY'), null);
  assert.equal(await getReadArtifact(s.DB, 'org_demo', hash, 'v2', 'PRIMARY'), null);
  assert.equal(await getReadArtifact(s.DB, 'org_demo', hash, 'v1', 'SECONDARY'), null);
  await assert.rejects(s.DB.prepare("UPDATE document_read_artifacts SET artifact_json='{}'").run(), /READ_ARTIFACT_IMMUTABLE/);
  await assert.rejects(putReadArtifact(s.DB, 'org_demo', hash, 'v2', 'PRIMARY', { text: 'x'.repeat(262144) }), /READ_ARTIFACT_TOO_LARGE/);
});

test('Jobs: processor vigente de otro canal conserva token, y eventos inválidos se descartan', async t => {
  const s = await setup(t); const invoice = await s.upload(); const j = await s.job(invoice);
  await stmt(s.DB, 'UPDATE invoices SET status=?,processing_token=?,processing_started_at=? WHERE id=?', 'PARSING', 'other-channel', now(), invoice.id).run();
  const msg = s.message({ kind: 'INVOICE_JOB', jobId: j.id });
  await consumeInvoiceJobs({ messages: [msg] }, s.env, () => assert.fail('El procesador está vigente'));
  assert.equal(msg.retries.length, 1); assert.equal((await s.job(invoice)).attempts, 0);
  assert.equal(await stmt(s.DB, 'SELECT processing_token FROM invoices WHERE id=?', invoice.id).first('processing_token'), 'other-channel');
  for (const body of [null, { kind: 'CHAT', jobId: j.id }, { kind: 'INVOICE_JOB', jobId: 'missing' }]) {
    const invalid = s.message(body); await consumeInvoiceJobs({ messages: [invalid] }, s.env, () => assert.fail('Evento inválido'));
    assert.equal(invalid.acks, 1);
  }
});

test('Jobs: worker con lease antiguo no finaliza ni falla un intento nuevo', async t => {
  const s = await setup(t); const invoice = await s.upload(); const j = await s.job(invoice);
  const body = { kind: 'INVOICE_JOB', jobId: j.id };
  let firstEntered, releaseFirst, secondEntered, releaseSecond;
  const firstStarted = new Promise(resolve => { firstEntered = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondStarted = new Promise(resolve => { secondEntered = resolve; });
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const old = consumeInvoiceJobs({ messages: [s.message(body)] }, s.env, async () => {
    firstEntered(); await firstGate; throw new Error('old worker failed');
  });
  await firstStarted;
  const oldToken = (await s.job(invoice)).lease_token;
  await stmt(s.DB, "UPDATE invoice_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", j.id).run();
  await recoverInvoiceJobs(s.env); await s.due(invoice);
  const current = consumeInvoiceJobs({ messages: [s.message(body)] }, s.env, async (...args) => {
    secondEntered(); await secondGate; return s.processing(...args);
  });
  await secondStarted;
  const newToken = (await s.job(invoice)).lease_token;
  assert.notEqual(newToken, oldToken);
  releaseFirst(); await old;
  assert.equal((await s.job(invoice)).state, 'RUNNING'); assert.equal((await s.job(invoice)).lease_token, newToken);
  assert.equal((await getInvoice(s.DB, 'org_demo', invoice.id)).status, 'RECEIVED');
  releaseSecond(); await current;
  assert.equal((await s.job(invoice)).state, 'DONE');
  assert.deepEqual(await s.ledger(), { decisions: 1, reservations: 1, reserved: 20000 });
});

test('Jobs: publicación reservada antes de crash vuelve a enviarse, sin gastar intentos', async t => {
  const s = await setup(t); const invoice = await s.upload();
  await stmt(s.DB, "UPDATE invoice_jobs SET enqueued_at='2000-01-01T00:00:00.000Z' WHERE invoice_id=?", invoice.id).run();
  assert.equal((await recoverInvoiceJobs(s.env)).dispatched, 1);
  assert.equal((await s.job(invoice)).attempts, 0);
  const msg = s.message(s.queue[0]);
  await consumeInvoiceJobs({ messages: [msg] }, s.env, async () => {
    await stmt(s.DB, "UPDATE invoices SET status='FAILED',processing_error_json=? WHERE id=?",
      JSON.stringify({ code: 'MODEL_REFUSED', retryable: false, message: 'Private input, never copy to job audit' }), invoice.id).run();
    return { data: await getInvoice(s.DB, 'org_demo', invoice.id), status: 200 };
  });
  assert.equal((await s.job(invoice)).state, 'DEAD');
  assert.deepEqual(JSON.parse((await s.job(invoice)).last_error_json), { code: 'MODEL_REFUSED', retryable: false });
  const history = (await s.DB.prepare('SELECT * FROM invoice_job_events').all()).results;
  assert.equal(JSON.stringify(history).includes('Private input'), false);
});

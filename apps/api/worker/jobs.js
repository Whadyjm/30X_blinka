import { HttpError, id, now, stmt } from './http.js';
import { getInvoice } from './repository.js';
import { processInvoice } from './processing.js';

const LEASE_MS = 180000; // The processing lease is 120s; reads have their own shorter deadlines.
const DISPATCH_MS = 60000;
const MAX_ATTEMPTS = 3;
const backoff = attempt => attempt === 1 ? 30 : 120;
const safeCodes = new Set(['ALL_MODELS_UNAVAILABLE', 'INVALID_OUTPUT', 'MODEL_REFUSED', 'INVALID_IMAGE', 'INVALID_PDF',
  'INVALID_IMAGE_SIZE_OR_COUNT', 'INVALID_DOCUMENT_HASH', 'MISSING_API_KEY', 'INVALID_API_KEY', 'INSUFFICIENT_CREDITS',
  'OPENROUTER_REQUEST_REJECTED', 'DOCUMENT_UNAVAILABLE', 'DOCUMENT_INTEGRITY_FAILED', 'PROCESSING_FAILED', 'CONCURRENT_UPDATE',
  'INDEPENDENT_READ_UNAVAILABLE',
  'SERVICE_UNAVAILABLE', 'MANDATE_REQUIRED', 'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE', 'NOT_FOUND', 'ABORTED',
  'JOB_RETRIES_EXHAUSTED', 'JOB_LEASE_EXPIRED', 'JOB_PROCESSING_INCOMPLETE']);
const safeCode = error => safeCodes.has(error?.code) ? error.code : 'PROCESSING_FAILED';
const errorData = (code, retryable) => ({ code, retryable,
  message: retryable ? 'El procesamiento se reintentará automáticamente.' : 'No se pudo completar el procesamiento; no se creó una aprobación.' });

export async function getReadArtifact(db, orgId, documentSha256, readerVersion, kind) {
  const row = await stmt(db, `SELECT artifact_json FROM document_read_artifacts
    WHERE org_id = ? AND document_sha256 = ? AND reader_version = ? AND kind = ?`, orgId, documentSha256, readerVersion, kind).first();
  return row ? JSON.parse(row.artifact_json) : null;
}

export async function putReadArtifact(db, orgId, documentSha256, readerVersion, kind, artifact) {
  const value = JSON.stringify(artifact);
  if (new TextEncoder().encode(value).length > 262144) throw new Error('READ_ARTIFACT_TOO_LARGE');
  await stmt(db, `INSERT INTO document_read_artifacts(org_id, document_sha256, reader_version, kind, artifact_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(org_id, document_sha256, reader_version, kind) DO NOTHING`,
  orgId, documentSha256, readerVersion, kind, value).run();
}

async function jobRow(db, jobId) {
  return stmt(db, `SELECT j.*, i.status AS invoice_status, i.processing_error_json, i.processing_token,
    i.processing_started_at FROM invoice_jobs j
    JOIN invoices i ON i.org_id = j.org_id AND i.id = j.invoice_id WHERE j.id = ?`, jobId).first();
}

async function dispatch(env, jobId) {
  if (!env.INVOICE_QUEUE) return false;
  const time = now();
  // This timestamp is a short publication lease: crash before/after send is recovered by the scheduler.
  const job = await stmt(env.DB, `UPDATE invoice_jobs SET enqueued_at = ?, updated_at = ? WHERE id = ?
    AND state IN ('PENDING','RETRY') AND attempts < ? AND next_attempt_at <= ?
    AND (enqueued_at IS NULL OR enqueued_at <= ?) RETURNING id`,
  time, time, jobId, MAX_ATTEMPTS, time, new Date(Date.now() - DISPATCH_MS).toISOString()).first();
  if (!job) return false;
  try {
    await env.INVOICE_QUEUE.send({ kind: 'INVOICE_JOB', jobId });
    return true;
  } catch {
    await stmt(env.DB, `UPDATE invoice_jobs SET enqueued_at = NULL WHERE id = ? AND enqueued_at = ?
      AND state IN ('PENDING','RETRY')`, jobId, time).run();
    console.error(JSON.stringify({ event: 'invoice_job_dispatch_failed', jobId }));
    return false;
  }
}

export async function enqueueInvoice(env, orgId, invoiceId, { retry = false } = {}) {
  const data = await getInvoice(env.DB, orgId, invoiceId);
  if (data.status === 'DECIDED' || data.status === 'FAILED' && !data.processingError?.retryable) return { data, status: 200 };
  if (!await stmt(env.DB, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId).first()) {
    throw new HttpError(409, 'MANDATE_REQUIRED');
  }
  // Trigger-backed intent already exists. A retry request cannot reset its lifetime attempt budget or bypass backoff.
  const job = await stmt(env.DB, 'SELECT * FROM invoice_jobs WHERE org_id = ? AND invoice_id = ?', orgId, invoiceId).first();
  if (!job) throw new HttpError(503, 'SERVICE_UNAVAILABLE');
  if (job.state === 'DEAD' || job.state === 'DONE') return { data, status: 200 };
  if (data.status === 'FAILED') await stmt(env.DB, `UPDATE invoices SET status = 'RECEIVED', updated_at = ?
    WHERE org_id = ? AND id = ? AND status = 'FAILED' AND json_extract(processing_error_json, '$.retryable') = 1
    AND EXISTS(SELECT 1 FROM invoice_jobs WHERE id = ? AND state IN ('PENDING','RETRY'))`,
  now(), orgId, invoiceId, job.id).run();
  await dispatch(env, job.id);
  return { data: await getInvoice(env.DB, orgId, invoiceId), status: 202 };
}

async function syncTerminalInvoice(env, job) {
  const processingError = JSON.parse(job.processing_error_json ?? 'null');
  const permanent = job.invoice_status === 'FAILED' && !processingError?.retryable;
  if (job.invoice_status !== 'DECIDED' && !permanent) return false;
  await stmt(env.DB, `UPDATE invoice_jobs SET state = ?, lease_token = NULL, lease_until = NULL,
    next_attempt_at = NULL, enqueued_at = NULL, last_error_json = ?, updated_at = ?
    WHERE id = ? AND state NOT IN ('DONE','DEAD')`,
  permanent ? 'DEAD' : 'DONE', permanent ? JSON.stringify({ code: safeCode(processingError), retryable: false }) : job.last_error_json,
  now(), job.id).run();
  return true;
}

async function finishAttempt(env, job, code, retryable) {
  const exhausted = job.attempts >= MAX_ATTEMPTS;
  const state = retryable && !exhausted ? 'RETRY' : 'DEAD';
  const error = errorData(exhausted && retryable ? 'JOB_RETRIES_EXHAUSTED' : code, state === 'RETRY');
  const time = now();
  // Invoice and job move together, fenced by the claimed job token; a stale worker cannot finalize a newer attempt.
  await env.DB.batch([
    stmt(env.DB, `UPDATE invoices SET status = ?, processing_error_json = ?, processing_token = NULL,
      processing_started_at = NULL, updated_at = ? WHERE org_id = ? AND id = ? AND status <> 'DECIDED'
      AND (processing_token IS NULL OR processing_started_at <= ?)
      AND EXISTS(SELECT 1 FROM invoice_jobs WHERE id = ? AND state = 'RUNNING' AND lease_token = ?)`,
    state === 'RETRY' ? 'RECEIVED' : 'FAILED', JSON.stringify(error), time, job.org_id, job.invoice_id,
    new Date(Date.now() - 120000).toISOString(), job.id, job.lease_token),
    stmt(env.DB, `UPDATE invoice_jobs SET state = ?, lease_token = NULL, lease_until = NULL, enqueued_at = NULL,
      next_attempt_at = ?, last_error_json = ?, updated_at = ? WHERE id = ? AND state = 'RUNNING' AND lease_token = ?`,
    state, state === 'RETRY' ? new Date(Date.now() + backoff(job.attempts) * 1000).toISOString() : null,
    JSON.stringify({ code, retryable, exhausted }), time, job.id, job.lease_token),
  ]);
  return state;
}

export async function recoverInvoiceJobs(env) {
  // Bound each sweep; the next minute resumes any remaining backlog. No provider calls run on the scheduler.
  const expired = (await stmt(env.DB, `SELECT j.*, i.status AS invoice_status, i.processing_error_json
    FROM invoice_jobs j JOIN invoices i ON i.org_id = j.org_id AND i.id = j.invoice_id
    WHERE j.state = 'RUNNING' AND j.lease_until <= ? ORDER BY j.lease_until LIMIT 100`, now()).all()).results;
  for (const job of expired) {
    if (!await syncTerminalInvoice(env, job)) await finishAttempt(env, job, 'JOB_LEASE_EXPIRED', true);
  }
  const ready = (await stmt(env.DB, `SELECT j.id FROM invoice_jobs j
    WHERE j.state IN ('PENDING','RETRY') AND j.next_attempt_at <= ?
    AND (j.enqueued_at IS NULL OR j.enqueued_at <= ?)
    AND EXISTS(SELECT 1 FROM policy_versions p WHERE p.org_id = j.org_id AND p.status = 'ACTIVE')
    ORDER BY j.next_attempt_at, j.id LIMIT 100`, now(), new Date(Date.now() - DISPATCH_MS).toISOString()).all()).results;
  let dispatched = 0;
  for (const row of ready) if (await dispatch(env, row.id)) dispatched++;
  return { expired: expired.length, dispatched };
}

async function consumeMessage(message, env, process) {
  const body = message.body;
  if (!body || body.kind !== 'INVOICE_JOB' || typeof body.jobId !== 'string' || body.jobId.length > 200) {
    message.ack(); return;
  }
  let job = await jobRow(env.DB, body.jobId);
  if (!job) { message.ack(); return; }
  if (await syncTerminalInvoice(env, job) || ['DONE', 'DEAD'].includes(job.state)) { message.ack(); return; }
  const time = Date.now();
  if (job.state === 'RUNNING' && Date.parse(job.lease_until) > time) {
    message.retry({ delaySeconds: Math.max(1, Math.ceil((Date.parse(job.lease_until) - time) / 1000)) }); return;
  }
  if (job.state === 'RUNNING') {
    await finishAttempt(env, job, 'JOB_LEASE_EXPIRED', true);
    message.ack(); return; // The durable RETRY intent is dispatched by the scheduler.
  }
  if (Date.parse(job.next_attempt_at) > time) {
    message.retry({ delaySeconds: Math.max(1, Math.ceil((Date.parse(job.next_attempt_at) - time) / 1000)) }); return;
  }
  // Preserve a live processor started by another channel before this queue was claimed.
  if (job.processing_token && Date.parse(job.processing_started_at) + 120000 > time) {
    message.retry({ delaySeconds: Math.max(1, Math.ceil((Date.parse(job.processing_started_at) + 120000 - time) / 1000)) }); return;
  }
  if (!await stmt(env.DB, "SELECT id FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", job.org_id).first()) {
    message.retry({ delaySeconds: 60 }); return;
  }
  const token = id('job');
  job = await stmt(env.DB, `UPDATE invoice_jobs SET state = 'RUNNING', attempts = attempts + 1, lease_token = ?,
    lease_until = ?, enqueued_at = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?
    AND state IN ('PENDING','RETRY') AND attempts < ? AND next_attempt_at <= ? RETURNING *`, token,
  new Date(time + LEASE_MS).toISOString(), new Date(time).toISOString(), job.id, MAX_ATTEMPTS, new Date(time).toISOString()).first();
  if (!job) { message.retry({ delaySeconds: 10 }); return; }
  let result;
  try {
    result = await process(env, job.org_id, job.invoice_id);
  } catch (error) {
    await finishAttempt(env, job, safeCode(error), !(error instanceof HttpError && error.status < 500));
    message.ack(); return;
  }
  const current = await jobRow(env.DB, job.id);
  if (await syncTerminalInvoice(env, current)) { message.ack(); return; }
  // A conflicting inline worker owns processing. Release this attempt durably rather than acknowledging unfinished work.
  const failure = result?.data?.processingError;
  await finishAttempt(env, job, failure ? safeCode(failure) : 'JOB_PROCESSING_INCOMPLETE', failure?.retryable !== false);
  message.ack();
}

export async function consumeInvoiceJobs(batch, env, process = processInvoice) {
  for (const message of batch.messages) {
    try { await consumeMessage(message, env, process); }
    catch {
      // DB finalization failed: never ack; redelivery or the expired durable lease will recover it.
      console.error(JSON.stringify({ event: 'invoice_job_consumer_failed' }));
      message.retry({ delaySeconds: 30 });
    }
  }
}

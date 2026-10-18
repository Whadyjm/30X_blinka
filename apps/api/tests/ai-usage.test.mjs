import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { aiUsage, meteredFetch, recordAiCall } from '../worker/ai-usage.js';
import { readDocument } from '../worker/document.js';
import { IMAGE_OCR_MODEL } from '@oli/extraction';

async function database(t) {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'ai-usage' } });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  const root = new URL('../../../packages/database/', import.meta.url);
  for (const file of readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort()) {
    await db.batch(readFileSync(new URL('migrations/' + file, root), 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => db.prepare(s)));
  }
  await db.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('one','One','USD','UTC'),('two','Two','USD','UTC')").run();
  return db;
}

test('usage persists each actual attempt, validates counts, separates tenants and preserves append-only history', async t => {
  const db = await database(t);
  const fetch = meteredFetch(db, 'one', 'CHAT', async () => Response.json({
    choices: [{ message: { refusal: 'invalid output still spends tokens' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } },
  }));
  for (let i = 0; i < 2; i++) assert.equal((await fetch('https://provider.invalid', { body: '{"model":"test"}' })).status, 200);
  await recordAiCall(db, 'one', 'PDF_CONVERSION', 'converter', async () => 'text');
  await assert.rejects(recordAiCall(db, 'one', 'CHAT', 'test', async () => { throw new Error('timeout'); }), /timeout/);
  await recordAiCall(db, 'one', 'CHAT', 'test', async () => ({ prompt_tokens: -4, completion_tokens: '12', total_tokens: 1.5 }), r => r);
  await recordAiCall(db, 'two', 'CHAT', 'test', async () => ({ prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 }), r => r);
  const usage = await aiUsage(db, 'one');
  assert.equal(usage.calls, 5);
  assert.equal(usage.totalTokens, 30, 'reasoning tokens are not added twice');
  assert.equal(usage.inputTokens, 20); assert.equal(usage.outputTokens, 10);
  assert.equal(usage.unreportedCalls, 3);
  assert.equal((await aiUsage(db, 'two')).totalTokens, 1000);
  await assert.rejects(db.prepare("DELETE FROM ai_usage_calls WHERE org_id='one'").run(), /APPEND_ONLY/);
  await assert.rejects(db.prepare('UPDATE ai_usage_results SET total_tokens=0').run(), /APPEND_ONLY/);
  // An interrupted request is already visible even when no completion can be saved.
  await db.prepare("INSERT INTO ai_usage_calls VALUES ('interrupted','one','CHAT','test','2026-10-17T00:00:00.000Z')").run();
  assert.equal((await aiUsage(db, 'one')).unreportedCalls, 4);
});

test('readers meter fallback attempts, PDF conversion and OCR, and cached artifacts do not spend again', async t => {
  const db = await database(t);
  const fields = { vendorName: null, invoiceNumber: null, amountMinor: null, currency: null,
    issuedAt: null, dueDate: null, servicePeriod: null, description: null, extractionWarnings: ['MISSING_FIELDS'], evidence: [] };
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++attempts === 1) return Response.json({ error: { message: 'try next reader' } }, { status: 503 });
    return Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: {
      content: body.model === IMAGE_OCR_MODEL ? 'NO INDICADO' : JSON.stringify({ documentType: 'INVOICE', ...fields }),
    } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  });
  const env = { DB: db, OPENROUTER_API_KEY: 'test-only', IMAGE_OCR_MODE: 'ENABLED', AI: { toMarkdown: async () => ({ data: 'NO INDICADO' }) } };
  const artifacts = {};
  const options = { orgId: 'one', artifacts, checkpoint: async (kind, value) => { artifacts[kind] = value; } };
  const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');
  await readDocument(env, { mimeType: 'application/pdf' }, bytes, 'a'.repeat(64), options);
  assert.equal((await aiUsage(db, 'one')).calls, 3, 'two primary attempts and a PDF conversion');
  await readDocument(env, { mimeType: 'application/pdf' }, bytes, 'a'.repeat(64), options);
  assert.equal((await aiUsage(db, 'one')).calls, 3, 'cache hit adds no call');
  await readDocument(env, { mimeType: 'image/png' }, new Uint8Array([137,80,78,71,13,10,26,10]), 'b'.repeat(64), { orgId: 'one' });
  const usage = await aiUsage(db, 'one');
  assert.equal(usage.calls, 5); assert.equal(usage.totalTokens, 360); assert.equal(usage.unreportedCalls, 2);
  assert.equal(usage.breakdown.find(row => row.category === 'INVOICE_OCR').totalTokens, 120);
});

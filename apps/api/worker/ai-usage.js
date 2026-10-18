import { AiUsageSchema } from '@oli/contracts';
import { id, now, readBytes, stmt } from './http.js';

const categories = ['INVOICE_EXTRACTION', 'INVOICE_OCR', 'PDF_CONVERSION', 'CHAT'];
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export async function recordAiCall(db, orgId, category, model, invoke, usageOf = () => null) {
  const callId = id('ai');
  await stmt(db, 'INSERT INTO ai_usage_calls(id, org_id, category, model, created_at) VALUES (?, ?, ?, ?, ?)',
    callId, orgId, category, model, now()).run();
  let usage;
  try {
    const result = await invoke();
    usage = usageOf(result);
    return result;
  } finally {
    const input = tokens(usage?.prompt_tokens), output = tokens(usage?.completion_tokens);
    // Reasoning is already included in completion_tokens; never add it twice.
    const total = tokens(usage?.total_tokens) ?? (input !== null && output !== null ? tokens(input + output) : null);
    await stmt(db, 'INSERT INTO ai_usage_results(call_id, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?)',
      callId, input, output, total).run();
  }
}

// Capture usage before invoice/chat validation, including refused or malformed model output.
export function meteredFetch(db, orgId, category, fetchImpl = fetch) {
  return async (url, init) => {
    const model = JSON.parse(init.body).model;
    const result = await recordAiCall(db, orgId, category, model, async () => {
      const response = await fetchImpl(url, init);
      const bytes = await readBytes(response, 256 * 1024);
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Unknown usage stays null. */ }
      return { response: new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers }), usage: payload?.usage };
    }, result => result.usage);
    return result.response;
  };
}

export async function aiUsage(db, orgId) {
  const rows = (await stmt(db, `SELECT c.category, count(*) AS calls,
    coalesce(sum(r.input_tokens), 0) AS inputTokens, coalesce(sum(r.output_tokens), 0) AS outputTokens,
    coalesce(sum(r.total_tokens), 0) AS totalTokens,
    sum(CASE WHEN r.input_tokens IS NULL OR r.output_tokens IS NULL OR r.total_tokens IS NULL THEN 1 ELSE 0 END) AS unreportedCalls,
    min(c.created_at) AS firstCallAt
    FROM ai_usage_calls c LEFT JOIN ai_usage_results r ON r.call_id = c.id
    WHERE c.org_id = ? GROUP BY c.category`, orgId).all()).results;
  const breakdown = categories.map(category => {
    const row = rows.find(row => row.category === category);
    return { category, calls: row?.calls ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0, unreportedCalls: row?.unreportedCalls ?? 0 };
  });
  const total = Object.fromEntries(['calls', 'inputTokens', 'outputTokens', 'totalTokens', 'unreportedCalls']
    .map(key => [key, breakdown.reduce((sum, row) => sum + row[key], 0)]));
  return AiUsageSchema.parse({ ...total, firstCallAt: rows.map(row => row.firstCallAt).sort()[0] ?? null, breakdown });
}

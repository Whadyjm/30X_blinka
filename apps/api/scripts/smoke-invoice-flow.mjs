import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const args = process.argv.slice(2);
const fileArg = args.indexOf('--file');
if (!args.includes('--run') || fileArg < 0 || !args[fileArg + 1]) {
  console.log('Usage: node scripts/smoke-invoice-flow.mjs --run --file <fictitious.pdf> [--approve]');
  console.log('Consumes OpenRouter, stores a real synthetic invoice/decision and optionally simulates OWNER approval.');
  process.exit(0);
}
const credentials = JSON.parse(await readFile(new URL('../.env.api-demo.json', import.meta.url), 'utf8'));
const bytes = await readFile(resolve(args[fileArg + 1]));
assert.ok(bytes.length > 0 && bytes.length <= 5242880);
const hash = createHash('sha256').update(bytes).digest('hex');
const stateDir = new URL('../.wrangler/demo/', import.meta.url); await mkdir(stateDir, { recursive: true });
const statePath = new URL(`${hash}.json`, stateDir);
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { uploadKey: crypto.randomUUID(), reviewKey: crypto.randomUUID() }; }
await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
let cookie; let csrf;
async function api(path, { method = 'GET', data, form, key } = {}) {
  const response = await fetch(`${credentials.baseUrl}/api/v1${path}`, { method, signal: AbortSignal.timeout(90000),
    headers: { Origin: credentials.baseUrl, ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: form ?? (data ? JSON.stringify(data) : undefined) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error?.code ?? 'UNKNOWN'}`);
  return { data: value.data, headers: response.headers };
}
const logged = await api('/session', { method: 'POST', data: { email: credentials.email, password: credentials.password } });
cookie = logged.headers.get('Set-Cookie').split(';')[0]; csrf = logged.data.csrfToken;
const form = new FormData(); form.append('file', new Blob([bytes], { type: 'application/pdf' }), basename(args[fileArg + 1]));
const uploaded = await api('/invoices', { method: 'POST', form, key: state.uploadKey });
state.invoiceId = uploaded.data.id; await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
let detail = (await api(`/invoices/${state.invoiceId}/process`, { method: 'POST' })).data;
if (args.includes('--approve') && detail.approvalRequest?.state === 'PENDING' && detail.approvalRequest.canApprove) {
  detail = (await api(`/approvals/${detail.approvalRequest.id}/decision`, { method: 'POST', key: state.reviewKey,
    data: { action: 'APPROVE', comment: 'Autorización OWNER simulada para verificar la integración con datos ficticios.',
      expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId } })).data.invoice;
}
const budgets = (await api('/budgets')).data;
const report = { scope: 'LIVE_SYNTHETIC_INTEGRATION_SMOKE', source: 'apps/api/scripts/smoke-invoice-flow.mjs',
  evaluatedAt: new Date().toISOString(), documentSha256: hash, invoice: detail, budgets,
  note: 'Una ejecución puntual con datos ficticios; no mide precisión OCR del corpus ni mueve dinero.' };
const reportPath = new URL(`../../../docs/evaluations/integration-${state.invoiceId}.json`, import.meta.url);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ invoiceId: state.invoiceId, status: detail.status, action: detail.latestDecision?.action,
  reasons: detail.latestDecision?.reasons, approvalState: detail.approvalRequest?.state,
  budgetReservedMinor: budgets.map(b => ({ currency: b.currency, reservedMinor: b.reservedMinor })) }));
if (detail.status === 'FAILED' || !detail.latestDecision) process.exitCode = 1;

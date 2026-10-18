import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { InvoiceDetailSchema } from '@oli/contracts';
import { normalizeInvoiceNumber } from '@oli/domain';
import { normalizeName } from '../worker/http.js';

assert.deepEqual(process.argv.slice(2), ['--run']);
const root = new URL('../../../', import.meta.url), base = 'https://oli30x.ultramare.dev';
const output = new URL('docs/evaluations/live-demo-prepared-20261017.json', root);
assert.ok(!existsSync(output), 'Demo preparation already recorded; never reset history to rehearse again.');
const manifestBytes = readFileSync(new URL('docs/fixtures/company-journey/ronda/manifest.json', root));
const manifest = JSON.parse(manifestBytes), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const auth = JSON.parse(execFileSync(new URL('../node_modules/.bin/wrangler', import.meta.url).pathname,
  ['auth', 'token', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const session = 'ses_' + randomUUID(), csrf = 'csrf_' + randomUUID();
const query = async (sql, params) => {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/fbaa64f96579f93b2db32a1eb12ff6c9/d1/database/349afff1-8b3b-4673-929b-ce6936c68d3a/query', {
    method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  assert.ok(r.ok, 'Cloudflare HTTP_' + r.status); const json = await r.json(); assert.ok(json.success); return json.result[0].results;
};
const api = async (path, method = 'GET', data, form) => {
  const r = await fetch(base + '/api/v1' + path, { method,
    headers: { Cookie: 'oli_session=' + session, Origin: base, 'X-CSRF-Token': csrf,
      ...(data ? { 'Content-Type': 'application/json' } : {}), ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) },
    body: form ?? (data ? JSON.stringify(data) : undefined), signal: AbortSignal.timeout(45000) });
  const json = await r.json(); assert.ok(r.ok, path + ' HTTP_' + r.status + ' ' + (json.error?.code ?? '')); return json.data;
};
const report = { scope: 'LIVE_DEMO_STAGING_FROM_KNOWN_FROZEN_DOCUMENTS_NOT_NEW_HOLDOUT_OR_ACCURACY_METRICS',
  startedAt: new Date().toISOString(), orgId: 'org_demo', sourceManifestSha256: hash(manifestBytes),
  limits: { uploadedDocuments: 3, uniqueKnownDocuments: 2, manualReviews: 0, externalReaderRetries: 0 },
  existingInvoicesAndPolicyModified: false, results: [] };
const save = () => { const body = JSON.stringify(report, null, 2) + '\n'; for (const secret of [auth.token, session, csrf]) assert.ok(!body.includes(secret)); writeFileSync(output, body); };
try {
  save();
  await query('INSERT INTO sessions(token_hash,org_id,user_id,csrf_token,expires_at) VALUES(?,?,?,?,?)',
    [hash(session), 'org_demo', 'user_demo_owner', csrf, new Date(Date.now() + 1200000).toISOString()]);
  assert.equal((await api('/me')).organization.id, 'org_demo');
  const policy = (await api('/mandate')).active; report.policyVersionId = policy.id;
  assert.equal(policy.rules.currency, 'USD'); assert.equal(policy.rules.automaticLimitMinor, 30000);
  assert.equal(policy.rules.reviewAboveMinor, 30000); assert.ok(policy.rules.hardLimitMinor >= 35000 && policy.rules.humanApprovalEnabled);
  report.before = (await api('/dashboard')).budgets;
  assert.ok(report.before.some(b => b.currency === 'USD' && b.availableMinor >= 48000));
  const vendors = await api('/vendors?pageSize=100'), agreements = await api('/agreements?pageSize=100');
  for (const id of ['001', '010']) {
    const scenario = manifest.cases.find(c => c.id === id), name = scenario.expectedExtraction.vendorName;
    let vendor = vendors.find(v => normalizeName(v.name) === normalizeName(name));
    if (vendor) assert.ok(vendor.allowed, 'Existing supplier is disallowed; do not mutate it.');
    else vendor = await api('/vendors', 'POST', { name, allowed: true, externalRef: null });
    const original = manifest.agreements.find(a => a.vendorKey === 'vendor_' + id), { key, vendorKey, ...data } = original;
    if (!agreements.some(a => a.vendorId === vendor.id && a.active && a.concept === data.concept && a.amountMinor === data.amountMinor && a.currency === data.currency)) {
      await api('/agreements', 'POST', { ...data, vendorId: vendor.id });
    }
  }
  for (const [label, id, action] of [['automatic', '001', 'APPROVE'], ['duplicate', '001', 'BLOCK'], ['humanPending', '010', 'ESCALATE']]) {
    const scenario = manifest.cases.find(c => c.id === id), bytes = readFileSync(new URL('docs/fixtures/company-journey/ronda/' + scenario.file.path, root));
    assert.equal(hash(bytes), scenario.file.sha256);
    const form = new FormData(); form.append('file', new Blob([bytes], { type: scenario.file.mimeType }), 'demo-' + label + '.' + scenario.file.path.split('.').at(-1));
    const uploaded = await api('/invoices', 'POST', undefined, form); await api('/invoices/' + uploaded.id + '/process', 'POST');
    let detail; const deadline = Date.now() + 360000;
    do {
      detail = InvoiceDetailSchema.parse(await api('/invoices/' + uploaded.id));
      if (detail.status === 'DECIDED') break;
      if (detail.status === 'FAILED' && (await query('SELECT state FROM invoice_jobs WHERE org_id=? AND invoice_id=?', ['org_demo', uploaded.id]))[0]?.state === 'DEAD') break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    } while (Date.now() < deadline);
    const row = { label, sourceCase: id, sourceFile: scenario.file, invoiceId: uploaded.id,
      url: base + '/app/bills/' + uploaded.id, detail }; report.results.push(row); save();
    assert.equal(detail.latestDecision?.action, action);
    if (label === 'automatic') for (const field of Object.keys(scenario.expectedExtraction)) {
      const a = detail.extraction[field], b = scenario.expectedExtraction[field];
      assert.ok(field === 'invoiceNumber' ? normalizeInvoiceNumber(a) === normalizeInvoiceNumber(b)
        : ['vendorName', 'description'].includes(field) ? normalizeName(a ?? '') === normalizeName(b ?? '') : a === b);
    }
    if (label === 'duplicate') assert.ok(detail.latestDecision.reasons.includes('DUPLICATE_INVOICE'));
    if (label === 'humanPending') assert.ok(detail.latestDecision.needsHumanApproval && detail.approvalRequest?.state === 'PENDING' && detail.approvalRequest.canApprove);
    console.log(JSON.stringify({ label, invoiceId: uploaded.id, action: detail.latestDecision.action }));
  }
  report.after = (await api('/dashboard')).budgets;
  assert.equal((await api('/mandate')).active.id, policy.id);
  report.ownedReservations = await query(`SELECT invoice_id,amount_minor FROM budget_reservations WHERE org_id=? AND invoice_id IN (?,?,?)`,
    ['org_demo', ...report.results.map(r => r.invoiceId)]);
  assert.equal(report.ownedReservations.length, 1); assert.equal(report.ownedReservations[0].amount_minor, 13000);
  report.ready = true;
} catch (error) { report.error = { name: error.name, message: error.message.slice(0, 1600) }; report.ready = false; process.exitCode = 1; }
finally {
  try { await query('DELETE FROM sessions WHERE token_hash=? AND org_id=?', [hash(session), 'org_demo']); report.sessionRevoked = true; }
  catch (error) { report.sessionRevoked = false; report.cleanupError = error.message; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ output: output.pathname, ready: report.ready, error: report.error }));
}

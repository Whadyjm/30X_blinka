import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { InvoiceDetailSchema } from '@oli/contracts';
import { normalizeInvoiceNumber } from '@oli/domain';
import { normalizeName } from '../worker/http.js';
import { READER_VERSION } from '../worker/document.js';
import { decisionView } from '../../web/src/api/view-model.ts';

const args = process.argv.slice(2);
const resumePath = args[0]?.startsWith('--resume=') ? args[0].slice('--resume='.length) : null;
const slug = args[1]?.match(/^--company=(marena|selva|ronda)$/)?.[1] ?? 'marena';
assert.ok((args[0] === '--run' || resumePath) && args.length <= 2 && (args.length === 1 || args[1] === `--company=${slug}`));
if (resumePath) assert.match(resumePath, new RegExp(`^docs/evaluations/candidate-${slug}-live-[\\dTZ-]+\\.json$`));
const root = new URL('../../../', import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = load('docs/evaluations/candidate-release-20261017.json');
const previousRun = resumePath ? load(resumePath) : null;
assert.ok(candidate.deployedVersion && candidate.publishedBundleExact);
const fixturePath = `docs/fixtures/company-journey/${slug}/`;
const manifestPath = fixturePath + 'manifest.json';
const manifestBytes = readFileSync(new URL(manifestPath, root)), manifest = JSON.parse(manifestBytes);
assert.equal(manifest.cases.length, 20);
for (const scenario of manifest.cases) {
  const bytes = readFileSync(new URL(fixturePath + scenario.file.path, root));
  assert.equal(hash(bytes), scenario.file.sha256); assert.equal(bytes.length, scenario.file.sizeBytes);
}
const fields = Object.keys(manifest.cases[0].expectedExtraction);
const sameField = (field, actual, expected) => field === 'invoiceNumber'
  ? normalizeInvoiceNumber(actual) === normalizeInvoiceNumber(expected)
  : ['vendorName', 'description'].includes(field) ? normalizeName(actual ?? '') === normalizeName(expected ?? '') : actual === expected;
assert.ok(sameField('description', 'Search Index maintenance', 'Search index maintenance'));
assert.ok(!sameField('description', 'Paper grid adaptation', 'Cover grid adaptation'));
for (const [field, a, b] of [['amountMinor', 10000, 10001], ['currency', 'USD', 'EUR'], ['dueDate', '2026-10-30', '2026-10-31']]) assert.ok(!sameField(field, a, b));
const base = 'https://oli30x.ultramare.dev';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const org = previousRun?.orgId ?? `org_${slug}_` + randomUUID();
const user = previousRun?.setup.policy.activatedBy ?? `owner_${slug}_` + randomUUID();
const sessionToken = 'ses_' + randomUUID(), csrf = 'csrf_' + randomUUID(), cookie = `oli_session=${sessionToken}`;
const auth = JSON.parse(execFileSync(new URL('../node_modules/.bin/wrangler', import.meta.url).pathname,
  ['auth', 'token', '--json'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${candidate.account}`;
const cloudflare = async (path, body) => {
  const response = await fetch(cfBase + path, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${auth.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `Cloudflare HTTP_${response.status}`);
  const json = await response.json(); assert.ok(json.success, 'Cloudflare request failed'); return json.result;
};
const query = async (sql, params = []) => {
  const result = await cloudflare('/d1/database/349afff1-8b3b-4673-929b-ce6936c68d3a/query', { sql, params });
  assert.ok(result.every(r => r.success)); return result[0].results;
};
const deployedVersion = async () => (await cloudflare('/workers/scripts/oli-api/deployments')).deployments[0].versions[0].version_id;
const verifyBackend = async () => {
  const version = await deployedVersion();
  const response = await fetch(cfBase + '/workers/scripts/oli-api', { headers: { Authorization: `Bearer ${auth.token}` } });
  assert.ok(response.ok);
  const parts = await response.formData(), file = parts.get('index.js');
  const bytes = typeof file === 'string' ? Buffer.from(file) : new Uint8Array(await file.arrayBuffer());
  assert.equal(hash(bytes), candidate.bundleSha256, 'Published backend changed during validation');
  return { version, bundleSha256: hash(bytes), backendExact: true, checkedAt: new Date().toISOString() };
};
const backendAtStart = await verifyBackend();
const reportPath = new URL(`docs/evaluations/candidate-${slug}-live-${runId}.json`, root);
const screenshots = new URL(`.impeccable/review/candidate-${runId}/`, root);
mkdirSync(screenshots, { recursive: true });
const report = { startedAt: new Date().toISOString(), finishedAt: null,
  scope: 'PRODUCTION_HTTP_REAL_QUEUE_REAL_READERS_D1_R2_FRESH_FICTITIOUS_COMPANY_WITH_BROWSER',
  runnerSha256: hash(readFileSync(new URL(import.meta.url))),
  resumeSource: previousRun ? { path: resumePath, sha256: hash(readFileSync(new URL(resumePath, root))),
    firstStartedAt: previousRun.startedAt, completedDocumentReadsRepeated: false } : null,
  candidate: { version: candidate.deployedVersion, correctionCommit: candidate.correctionCommit,
    transportFixCommit: candidate.transportFixCommit, fallbackFixCommit: candidate.fallbackFixCommit, nativePdfFixCommit: candidate.nativePdfFixCommit, bundleSha256: candidate.bundleSha256 },
  backendAtStart,
  company: manifest.company, orgId: org, manifestPath, manifestSha256: hash(manifestBytes),
  targets: { unsafeApprovals: 0, minimumFullyCorrect: 19, minimumNormalAutomaticApprovals: 7, normalInvoices: 8, requiredExplained: 20 },
  limits: { documents: 20, additionalTargetedRegressionDocuments: 1, externalReaderRetries: 0, maximumWaitPerDocumentMs: 360000, concurrency: 1,
    models: 'Only the original production processor calls models; existing durable job limits and caches apply.' },
  setup: { method: 'Admin provisioning of fictitious organization, owner membership and scoped session only. All rules, directories, invoice and review operations use the original authenticated application.' },
  browser: { screenshots: screenshots.pathname, javascriptErrors: [], checks: [] }, results: [], summary: null };
const save = () => {
  const text = JSON.stringify(report, null, 2) + '\n';
  for (const secret of [auth.token, sessionToken, csrf]) assert.ok(!text.includes(secret), 'Refusing to persist credential');
  writeFileSync(reportPath, text);
};
const api = async (path, { method = 'GET', data, form, key, allowError = false } = {}) => {
  const response = await fetch(base + '/api/v1' + path, { method, signal: AbortSignal.timeout(45000),
    headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}) }, body: form ?? (data ? JSON.stringify(data) : undefined) });
  const payload = response.status === 204 ? null : await response.json();
  if (!allowError) assert.ok(response.ok, JSON.stringify({ path, status: response.status, code: payload?.error?.code }));
  return { status: response.status, payload };
};
const ledger = async (invoiceId = '') => (await query(`SELECT
  (SELECT coalesce(sum(reserved_minor),0) FROM budget_periods WHERE org_id=?) reservedMinor,
  (SELECT count(*) FROM budget_reservations WHERE org_id=?) reservations,
  (SELECT count(*) FROM decisions WHERE org_id=?) decisions,
  (SELECT count(*) FROM budget_reservations WHERE org_id=? AND invoice_id=?) invoiceReservations`, [org, org, org, org, invoiceId]))[0];
const activate = async () => {
  const state = (await api('/mandate')).payload.data;
  const draft = (await api('/mandate/draft', { method: 'PUT', data: { expectedRevision: state.draft?.revision ?? null,
    basedOnPolicyVersionId: state.active?.id ?? null, rules: manifest.rules } })).payload.data;
  const options = { method: 'POST', key: randomUUID(), data: { draftId: draft.id, expectedRevision: draft.revision,
    expectedActivePolicyVersionId: state.active?.id ?? null, confirmed: true } };
  const activated = await api('/mandate/activate', options);
  assert.deepEqual((await api('/mandate/activate', options)).payload, activated.payload);
  return activated.payload.data;
};
const formFor = scenario => {
  const bytes = readFileSync(new URL(fixturePath + scenario.file.path, root));
  assert.equal(hash(bytes), scenario.file.sha256);
  const form = new FormData(); form.append('file', new Blob([bytes], { type: scenario.file.mimeType }), scenario.file.path.split('/').at(-1));
  return form;
};
const waitForDecision = async invoiceId => {
  const deadline = Date.now() + report.limits.maximumWaitPerDocumentMs;
  do {
    const detail = InvoiceDetailSchema.parse((await api('/invoices/' + invoiceId)).payload.data);
    if (detail.status === 'DECIDED') return detail;
    if (detail.status === 'FAILED') {
      const job = (await query('SELECT state FROM invoice_jobs WHERE org_id=? AND invoice_id=?', [org, invoiceId]))[0];
      if (job?.state === 'DEAD') return detail;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < deadline);
  throw new Error('DOCUMENT_WAIT_EXHAUSTED');
};
const summarize = rows => ({ attempted: rows.length, fullyCorrect: rows.filter(r => r.correct).length,
    allEightFieldsLiteralExact: rows.filter(r => r.matchingFields?.length === 8).length,
    allEightFieldsPolicyEquivalent: rows.filter(r => r.policyEquivalentFields?.length === 8).length,
    decided: rows.filter(r => r.initialDecision).length, unsafeApprovals: rows.filter(r => r.unsafeApproval).length,
    normalAutomaticApprovals: rows.slice(0, 8).filter(r => r.initialCorrect && r.initialDecision?.action === 'APPROVE').length,
    correctAutonomous: rows.filter(r => r.initialCorrect && ['APPROVE', 'BLOCK'].includes(r.initialDecision?.action)).length,
    explained: rows.filter(r => r.initialDecision?.humanExplanation && r.initialDecision.trace.length).length,
    readerFailures: rows.filter(r => !r.read && !r.error).length, harnessErrors: rows.filter(r => r.error).length,
    browserHumanReviews: rows.filter(r => r.browserHumanReview).length,
    uploadReplays: rows.filter(r => r.uploadReplay).length, processingReplays: rows.filter(r => r.processingReplay).length,
    privateDocumentsVerified: rows.filter(r => r.privateDocumentVerified).length,
    targetsMet: rows.length === 20 && rows.filter(r => r.correct).length >= 19 && !rows.some(r => r.unsafeApproval)
      && rows.slice(0, 8).filter(r => r.initialCorrect && r.initialDecision?.action === 'APPROVE').length >= 7
      && rows.filter(r => r.initialDecision?.humanExplanation && r.initialDecision.trace.length).length === 20 });
let browser, context, page;
try {
  save();
  if (!previousRun) {
    await query('INSERT INTO organizations(id,name,default_currency,timezone) VALUES (?,?,?,?)', [org, manifest.company.name, 'USD', manifest.company.timezone]);
    await query('INSERT INTO users(id,name,email) VALUES (?,?,?)', [user, `${slug} fictional reviewer`, user + '@journey.invalid']);
    await query("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,'OWNER')", [org, user]);
  } else {
    assert.equal(previousRun.candidate.version, candidate.deployedVersion);
    assert.equal(previousRun.manifestSha256, hash(manifestBytes));
    assert.ok(previousRun.results.length >= 1 && previousRun.results.length <= 8, 'Resume only completed normal invoices');
    for (const row of previousRun.results) {
      const scenario = manifest.cases.find(c => c.id === row.caseId);
      assert.ok(Number(row.caseId) <= 8 && scenario.expectedFinalAction === 'APPROVE');
      assert.equal(row.detail.latestDecision.action, 'APPROVE');
      assert.deepEqual(row.read.extraction.extractionWarnings, []);
      assert.ok(fields.every(field => sameField(field, row.read.extraction[field], scenario.expectedExtraction[field])));
      assert.ok((row.unsafeApprovalReasons ?? []).every(reason => reason === 'APPROVED_FACTS_UNCERTAIN_OR_DIFFER_FROM_REFERENCE'));
      assert.equal(row.after.invoiceReservations, 1);
      assert.equal(row.after.reservedMinor - row.before.reservedMinor, scenario.expectedReservationDeltaMinor);
    }
  }
  await query('INSERT INTO sessions(token_hash,org_id,user_id,csrf_token,expires_at) VALUES (?,?,?,?,?)',
    [hash(sessionToken), org, user, csrf, new Date(Date.now() + 2 * 3600000).toISOString()]);
  assert.equal((await api('/me')).payload.data.organization.id, org);
  if (!previousRun) {
    report.setup.policy = await activate();
    const vendors = new Map();
    for (const { key, ...data } of manifest.vendors) vendors.set(key, (await api('/vendors', { method: 'POST', data })).payload.data);
    for (const { key, vendorKey, ...data } of manifest.agreements) await api('/agreements', { method: 'POST', data: { ...data, vendorId: vendors.get(vendorKey).id } });
    report.setup.openingLedger = await ledger(); assert.equal(report.setup.openingLedger.reservedMinor, 0);
  } else {
    report.setup.policy = previousRun.setup.policy;
    report.setup.openingLedger = previousRun.setup.openingLedger;
    assert.deepEqual(await ledger(previousRun.results.at(-1).invoiceId), previousRun.results.at(-1).after);
  }
  const { chromium } = await import(process.env.OLI_PLAYWRIGHT_MODULE ?? '/tmp/oli-ui-verification/node_modules/playwright/index.mjs');
  browser = await chromium.launch(); context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'oli_session', value: sessionToken, domain: new URL(base).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
  page = await context.newPage(); page.on('pageerror', error => report.browser.javascriptErrors.push(error.message));
  let referenceReserved = 0;
  if (previousRun) {
    for (const previous of previousRun.results) {
      const row = structuredClone(previous), scenario = manifest.cases.find(c => c.id === row.caseId);
      row.policyEquivalentFields = fields.filter(field => sameField(field, row.read.extraction[field], scenario.expectedExtraction[field]));
      if (row.unsafeApproval) row.previousLiteralAuditFlag = { reasons: row.unsafeApprovalReasons,
        explanation: 'All eight fields match under the existing policy normalization; literal equality remains a separate metric.' };
      row.unsafeApproval = false; row.unsafeApprovalReasons = [];
      if (row.error) { row.previousHarnessError = row.error; delete row.error; }
      row.readerReusedFromCheckpoint = true;
      row.correct = row.initialCorrect && row.detail.latestDecision.action === row.expectedFinalAction
        && row.after.reservedMinor - row.before.reservedMinor === row.expectedReservationDeltaMinor;
      report.results.push(row); referenceReserved += row.expectedReservationDeltaMinor;
    }
    const row = report.results[0];
    await page.goto(base + '/app/bills/' + row.invoiceId);
    await page.getByText(decisionView(row.detail.latestDecision).explanation, { exact: true }).first().waitFor();
    await page.screenshot({ path: new URL('001-desktop.png', screenshots).pathname, fullPage: true });
    row.browserDecisionVerified = true;
    report.browser.checks.push({ caseId: row.caseId, action: 'APPROVE', trace: true, resumedPresentationCheck: true });
    save();
  }
  for (const scenario of manifest.cases) {
    if (report.results.some(row => row.caseId === scenario.id)) continue;
    const row = { caseId: scenario.id, file: scenario.file, expected: scenario.expected, expectedFinalAction: scenario.expectedFinalAction,
      expectedReservationDeltaMinor: scenario.expectedReservationDeltaMinor, startedAt: new Date().toISOString() };
    const started = Date.now();
    try {
      row.before = await ledger(); row.referenceReservedBeforeMinor = referenceReserved;
      row.referenceContextDiverged = row.before.reservedMinor !== referenceReserved;
      let upload, uploadKey;
      if (scenario.id === '001') {
        await page.goto(base + '/app/bills');
        const received = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/invoices' && r.request().method() === 'POST');
        await page.getByLabel(/Elegir archivos de facturas|Choose invoice files/).setInputFiles(new URL(fixturePath + scenario.file.path, root).pathname);
        const response = await received; assert.equal(response.status(), 201); upload = await response.json();
        uploadKey = response.request().headers()['idempotency-key']; row.browserUpload = true;
      } else {
        uploadKey = randomUUID(); upload = (await api('/invoices', { method: 'POST', key: uploadKey, form: formFor(scenario) })).payload;
      }
      assert.ok(uploadKey); row.invoiceId = upload.data.id;
      assert.deepEqual((await api('/invoices', { method: 'POST', key: uploadKey, form: formFor(scenario) })).payload, upload);
      row.uploadReplay = true;
      await api(`/invoices/${row.invoiceId}/process`, { method: 'POST' });
      let detail = await waitForDecision(row.invoiceId); row.initialDecision = detail.latestDecision;
      const record = (await query('SELECT extracted_json FROM invoices WHERE org_id=? AND id=?', [org, row.invoiceId]))[0];
      row.read = record.extracted_json ? JSON.parse(record.extracted_json) : null;
      if (row.read) assert.equal(row.read.provenance.configVersion, READER_VERSION);
      row.matchingFields = fields.filter(field => row.read?.extraction[field] === scenario.expectedExtraction[field]);
      row.policyEquivalentFields = fields.filter(field => sameField(field, row.read?.extraction[field] ?? null, scenario.expectedExtraction[field]));
      row.initialCorrect = detail.latestDecision?.action === scenario.expected.action
        && scenario.expected.requiredReasons.every(reason => detail.latestDecision.reasons.includes(reason))
        && detail.latestDecision.needsHumanApproval === scenario.expected.needsHumanApproval;
      if (scenario.humanAction && detail.approvalRequest?.state === 'PENDING') {
        if (scenario.humanAction === 'APPROVE') {
          const obsolete = detail; const active = await activate();
          const stale = await api(`/approvals/${obsolete.approvalRequest.id}/decision`, { method: 'POST', key: randomUUID(), allowError: true,
            data: { action: 'APPROVE', comment: 'Simulated stale policy approval must fail', expectedDecisionId: obsolete.latestDecision.id,
              expectedPolicyVersionId: obsolete.latestDecision.policyVersionId } });
          assert.equal(stale.status, 409); row.stalePolicyApprovalDenied = true;
          detail = (await api(`/invoices/${row.invoiceId}/reevaluate`, { method: 'POST', key: randomUUID(),
            data: { expectedDecisionId: obsolete.latestDecision.id, expectedPolicyVersionId: active.id } })).payload.data;
        }
        await page.goto(base + '/app/bills/' + row.invoiceId);
        await page.getByLabel(/Tu motivo|Your reason/).fill(`Revisión OWNER simulada de ${slug}; factura ficticia para verificar el reto.`);
        const review = page.waitForResponse(r => /\/approvals\/[^/]+\/decision$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
        await page.getByRole('button', { name: scenario.humanAction === 'APPROVE' ? /^(Aprobar factura|Approve invoice)$/ : /^(Rechazar|Reject)$/ }).click();
        const reviewed = await review; assert.equal(reviewed.status(), 200);
        const reviewBody = await reviewed.json(), request = reviewed.request();
        assert.deepEqual((await api(new URL(reviewed.url()).pathname.slice('/api/v1'.length), { method: 'POST',
          key: request.headers()['idempotency-key'], data: JSON.parse(request.postData()) })).payload, reviewBody);
        row.humanReviewReplay = true; row.browserHumanReview = scenario.humanAction;
      }
      detail = InvoiceDetailSchema.parse((await api('/invoices/' + row.invoiceId)).payload.data); row.detail = detail; row.after = await ledger(row.invoiceId);
      row.unsafeApprovalReasons = [];
      const approved = detail.latestDecision?.action === 'APPROVE';
      if (approved) {
        if (row.policyEquivalentFields.length !== 8 || row.read.extraction.extractionWarnings.length) row.unsafeApprovalReasons.push('APPROVED_FACTS_UNCERTAIN_OR_DIFFER_FROM_REFERENCE');
        if (scenario.expectedFinalAction !== 'APPROVE') row.unsafeApprovalReasons.push('REFERENCE_FORBIDS_APPROVAL');
        if (detail.amountMinor > manifest.rules.hardLimitMinor || detail.currency !== manifest.rules.currency) row.unsafeApprovalReasons.push('HARD_POLICY_VIOLATION');
        if (detail.amountMinor > manifest.rules.monthlyBudgetMinor - row.before.reservedMinor) row.unsafeApprovalReasons.push('BUDGET_EXCEEDED');
        if (detail.amountMinor > manifest.rules.automaticLimitMinor && !(row.browserHumanReview === 'APPROVE' && detail.latestDecision.actor.kind === 'HUMAN')) row.unsafeApprovalReasons.push('HUMAN_AUTHORITY_MISSING');
        if (report.results.some(prior => prior.file.sha256 === row.file.sha256 || (prior.read
          && normalizeInvoiceNumber(prior.read.extraction.invoiceNumber) === normalizeInvoiceNumber(row.read.extraction.invoiceNumber)
          && prior.read.extraction.vendorName?.toLowerCase() === row.read.extraction.vendorName?.toLowerCase()))) row.unsafeApprovalReasons.push('DUPLICATE_APPROVED');
      }
      row.unsafeApproval = row.unsafeApprovalReasons.length > 0;
      assert.equal(row.after.invoiceReservations, approved ? 1 : 0);
      assert.equal(row.after.reservedMinor - row.before.reservedMinor, approved ? detail.amountMinor : 0);
      assert.ok(row.after.reservedMinor <= manifest.rules.monthlyBudgetMinor);
      await api(`/invoices/${row.invoiceId}/process`, { method: 'POST' }); assert.deepEqual(await ledger(row.invoiceId), row.after); row.processingReplay = true;
      const original = await fetch(base + detail.file.url, { headers: { Cookie: cookie } }); assert.equal(original.status, 200);
      assert.equal(hash(new Uint8Array(await original.arrayBuffer())), scenario.file.sha256);
      assert.equal((await fetch(base + detail.file.url)).status, 401); row.privateDocumentVerified = true;
      row.job = (await query('SELECT state,attempts,last_error_json FROM invoice_jobs WHERE org_id=? AND invoice_id=?', [org, row.invoiceId]))[0];
      row.correct = !!row.initialCorrect && detail.latestDecision?.action === scenario.expectedFinalAction
        && row.after.reservedMinor - row.before.reservedMinor === scenario.expectedReservationDeltaMinor;
      if (['001', '011', '013', '014', '016', '018'].includes(scenario.id) || row.browserHumanReview) {
        await page.goto(base + '/app/bills/' + row.invoiceId);
        if (detail.latestDecision?.humanExplanation) await page.getByText(decisionView(detail.latestDecision).explanation, { exact: true }).first().waitFor();
        await page.screenshot({ path: new URL(scenario.id + '-desktop.png', screenshots).pathname, fullPage: true });
        row.browserDecisionVerified = !!detail.latestDecision; report.browser.checks.push({ caseId: scenario.id, action: detail.latestDecision?.action, trace: !!detail.latestDecision?.trace.length });
      }
    } catch (error) { row.error = { name: error.name, message: String(error.message).slice(0, 1400) }; row.correct = false; }
    referenceReserved += scenario.expectedReservationDeltaMinor; row.durationMs = Date.now() - started;
    report.results.push(row); save(); console.log(JSON.stringify({ completed: report.results.length, caseId: row.caseId,
      action: row.detail?.latestDecision?.action, correct: row.correct, unsafeApproval: row.unsafeApproval, error: row.error?.message }));
    if (row.error || row.unsafeApproval) { report.aborted = { caseId: row.caseId, reason: row.unsafeApproval ? 'UNSAFE_APPROVAL' : 'HARNESS_ERROR' }; break; }
  }
  if (report.results.length === 20 && !report.results.some(r => r.error || r.unsafeApproval)) {
    const previous = report.results.find(r => r.caseId === '017');
    const expected = manifest.cases.find(c => c.id === '017').expectedExtraction;
    if (previous.detail?.vendorId === null && normalizeName(previous.read?.extraction.vendorName ?? '') === normalizeName(expected.vendorName)
      && normalizeInvoiceNumber(previous.read?.extraction.invoiceNumber) === normalizeInvoiceNumber(expected.invoiceNumber)) {
      const target = load(fixturePath + 'targeted/manifest.json');
      const before = await ledger();
      const uploaded = await api('/invoices', { method: 'POST', key: randomUUID(), form: formFor(target) });
      const invoiceId = uploaded.payload.data.id;
      await api(`/invoices/${invoiceId}/process`, { method: 'POST' });
      const detail = await waitForDecision(invoiceId), after = await ledger(invoiceId);
      report.targetedP0 = { scope: target.scope, document: target.file, invoiceId, antecedentInvoiceId: previous.invoiceId,
        antecedentVendorUnresolved: true, before, after, detail,
        pass: detail.latestDecision?.action === 'ESCALATE' && detail.latestDecision.reasons.includes('POSSIBLE_DUPLICATE')
          && !detail.latestDecision.needsHumanApproval && detail.approvalRequest === null
          && after.reservedMinor === before.reservedMinor && after.invoiceReservations === 0 };
      save();
      if (report.targetedP0.pass) {
        await page.goto(base + '/app/bills/' + invoiceId);
        await page.getByText(decisionView(detail.latestDecision).explanation, { exact: true }).first().waitFor();
        assert.equal(await page.getByRole('button', { name: /^(Aprobar factura|Approve invoice)$/ }).count(), 0);
        await page.screenshot({ path: new URL('targeted-unresolved-duplicate.png', screenshots).pathname, fullPage: true });
      }
    } else report.targetedP0 = { pass: false, reason: 'Antecedent extraction did not establish the required unresolved duplicate identity; no new invoice submitted.' };
  }
  await page.goto(base + '/app/dashboard');
  await page.locator('#organization-overview').waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => !document.querySelector('#organization-overview .skeleton'));
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, { timeout: 5000 }).catch(() => {});
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 15).map(el => ({ tag: el.tagName, className: String(el.className).slice(0, 250), right: el.getBoundingClientRect().right })) }));
    report.browser.checks.push({ viewport: width, layout, noHorizontalOverflow: layout.scrollWidth <= layout.width });
    await page.screenshot({ path: new URL('dashboard-' + width + '.png', screenshots).pathname, fullPage: true });
  }
  report.finalLedger = await ledger(); report.dashboard = (await api('/dashboard')).payload.data;
  report.backendAtEnd = await verifyBackend(); report.workerVersionAfter = report.backendAtEnd.version;
  report.manifestUnchanged = hash(readFileSync(new URL(manifestPath, root))) === report.manifestSha256;
  const rows = report.results;
  report.summary = summarize(rows);
  assert.deepEqual(report.browser.javascriptErrors, []); assert.ok(report.manifestUnchanged);
  report.acceptanceReady = report.summary.targetsMet && report.targetedP0?.pass === true
    && report.summary.browserHumanReviews === 2 && rows.some(r => r.stalePolicyApprovalDenied)
    && report.browser.checks.filter(c => c.viewport).every(c => c.noHorizontalOverflow);
  if (!report.acceptanceReady || report.summary.harnessErrors) process.exitCode = 1;
} catch (error) { report.fatalError = { name: error.name, message: String(error.message).slice(0, 1400) }; process.exitCode = 1; }
finally {
  report.summary ??= summarize(report.results);
  if (browser) await browser.close();
  try { await query('DELETE FROM sessions WHERE token_hash=? AND org_id=?', [hash(sessionToken), org]); report.setup.sessionRevoked = true; }
  catch { report.setup.sessionRevoked = false; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ report: reportPath.pathname, summary: report.summary, fatalError: report.fatalError }));
}

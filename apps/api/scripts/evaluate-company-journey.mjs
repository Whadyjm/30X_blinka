import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Miniflare } from 'miniflare';
import { CreateAgreementSchema, CreateVendorSchema, ExtractedInvoiceSchema, InvoiceDetailSchema,
  MandateRulesSchema, checkExtraction } from '@oli/contracts';
import { ExtractionError } from '@oli/extraction';
import worker from '../worker/index.js';
import { processInvoice } from '../worker/processing.js';
import { consumeInvoiceJobs } from '../worker/jobs.js';
import { READER_VERSION, readDocument, validateDocument } from '../worker/document.js';

const args = process.argv.slice(2);
const mode = args[0];
const slug = args[1]?.match(/^--company=(lumen|brisa|cedro|marena)$/)?.[1];
const replayPath = args[2]?.match(/^--source=(.+)$/)?.[1];
assert.ok(['--validate', '--self-test', '--run', '--replay', '--reparse'].includes(mode) && slug
  && (['--replay', '--reparse'].includes(mode) ? args.length === 3 && replayPath : args.length === 2),
  'Usage: node apps/api/scripts/evaluate-company-journey.mjs --validate|--self-test|--run|--replay|--reparse --company=lumen|brisa|cedro|marena [--source=report.json]');
const live = mode === '--run';
const synthetic = mode === '--self-test';
const reparse = mode === '--reparse';
const root = new URL('../../../', import.meta.url);
const fixtureRoot = new URL(`docs/fixtures/company-journey/${slug}/`, root);
const manifestBytes = readFileSync(new URL('manifest.json', fixtureRoot));
const manifest = JSON.parse(manifestBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const replayBytes = replayPath ? readFileSync(replayPath) : null;
const replay = replayBytes ? JSON.parse(replayBytes) : null;
const conversionPath = 'docs/fixtures/company-journey/pdf-text-captures-20261017.json';
const conversionBytes = reparse ? readFileSync(new URL(conversionPath, root)) : null;
const conversions = conversionBytes ? JSON.parse(conversionBytes) : null;
if (replay) {
  assert.equal(replay.company.slug, slug);
  assert.equal(replay.manifestSha256, hash(manifestBytes));
  assert.equal(replay.results.length, manifest.cases.length);
  for (const scenario of manifest.cases) {
    const row = replay.results.find(r => r.caseId === scenario.id);
    assert.equal(row?.file.sha256, scenario.file.sha256);
    assert.ok(row.read || row.readerError, `Missing frozen reader outcome ${scenario.id}`);
  }
}
const fields = ['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'servicePeriod', 'description'];
const critical = ['vendorName', 'amountMinor', 'currency', 'dueDate'];
const rules = MandateRulesSchema.parse(manifest.rules);
assert.equal(manifest.synthetic, true);
assert.equal(manifest.company.slug, slug);
assert.equal(manifest.cases.length, 20);
assert.equal(new Set(manifest.cases.map(c => c.id)).size, 20);
const documents = new Map();
for (const scenario of manifest.cases) {
  assert.match(scenario.file.path, /^documents\/[\w.-]+\.(pdf|png|jpe?g)$/);
  const path = resolve(fixtureRoot.pathname, scenario.file.path);
  assert.ok(path.startsWith(resolve(fixtureRoot.pathname) + sep));
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), scenario.file.sha256);
  assert.equal(bytes.length, scenario.file.sizeBytes);
  assert.ok(bytes.length > 0 && bytes.length <= 5 * 1024 * 1024);
  validateDocument(bytes, scenario.file.mimeType);
  ExtractedInvoiceSchema.parse({ ...scenario.expectedExtraction, extractionWarnings: [], evidence: [] });
  assert.deepEqual(Object.keys(scenario.expectedExtraction).sort(), [...fields].sort());
  assert.ok(['APPROVE', 'BLOCK', 'ESCALATE'].includes(scenario.expected.action));
  assert.ok(['APPROVE', 'BLOCK', 'ESCALATE'].includes(scenario.expectedFinalAction));
  assert.ok([null, 'APPROVE', 'REJECT'].includes(scenario.humanAction));
  documents.set(scenario.id, bytes);
}
for (const vendor of manifest.vendors) CreateVendorSchema.parse({ name: vendor.name, allowed: vendor.allowed, externalRef: vendor.externalRef });
for (const agreement of manifest.agreements) {
  assert.ok(manifest.vendors.some(v => v.key === agreement.vendorKey));
  const { key, vendorKey, ...data } = agreement;
  CreateAgreementSchema.parse({ ...data, vendorId: vendorKey });
}
if (mode === '--validate') {
  console.log(JSON.stringify({ company: slug, validatedDocuments: documents.size, manifestSha256: hash(manifestBytes), modelCalls: 0 }));
  process.exit(0);
}

// Live runs send only original bytes to the existing authenticated production reader probe.
// The original API, queue consumer, domain engine and D1 triggers run locally without product changes.
const token = live ? readFileSync(new URL('.env.extraction-probe', root), 'utf8').trim() : null;
if (live) assert.ok(token.length >= 32 && token.length < 512);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = new URL(`docs/evaluations/company-journey-${slug}-${live ? '' : synthetic ? 'selftest-' : reparse ? 'reparse-' : 'replay-'}${runId}.json`, root);
const statePath = resolve(new URL(`../.wrangler/company-journey/${slug}/${runId}/`, import.meta.url).pathname);
mkdirSync(statePath, { recursive: true });
const sourcePaths = ['apps/api/scripts/evaluate-company-journey.mjs', 'apps/api/worker/api.js',
  'apps/api/worker/auth.js', 'apps/api/worker/configuration.js', 'apps/api/worker/invoices.js',
  'apps/api/worker/processing.js', 'apps/api/worker/reevaluation.js', 'apps/api/worker/repository.js',
  'apps/api/worker/jobs.js', 'apps/api/worker/document.js', 'packages/extraction/src/openrouter.ts',
  'packages/domain/src/index.ts', 'packages/contracts/src/index.ts'];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(new URL(path, root)))]));
const target = 'https://oli-api.tiamat-agency.workers.dev';
const report = {
  runId, startedAt: new Date().toISOString(), finishedAt: null,
  scope: live ? 'REAL_REMOTE_READERS_LOCAL_API_QUEUE_CONSUMER_D1_R2_CUMULATIVE_COMPANY'
    : synthetic ? 'SYNTHETIC_READS_LOCAL_JOURNEY_HARNESS_SELF_TEST_NOT_OCR_METRICS'
    : reparse ? 'OFFLINE_CURRENT_READER_FROZEN_PRIMARY_AND_IMAGE_TEXT_NEW_PDF_CAPTURES_LOCAL_API_D1_NOT_NEW_E2E'
    : 'FROZEN_HISTORICAL_READS_CURRENT_DOMAIN_API_D1_NOT_NEW_OCR_METRICS',
  replaySource: replay ? { path: replayPath, sha256: hash(replayBytes), runId: replay.runId,
    note: reparse ? 'Primary model outputs and Qwen transcripts frozen; PDF text newly captured. Current reader comparison and financial processing, no live model calls.'
      : 'Historical reader outputs and errors are replayed unchanged; no new extraction or reader-version claim.',
    conversions: reparse ? { path: conversionPath, sha256: hash(conversionBytes) } : null } : null,
  company: manifest.company, datasetVersion: manifest.datasetVersion, manifestSha256: hash(manifestBytes),
  localCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes: sourceHashes(), sourceUnchanged: null,
  remoteReaderTarget: live ? target : null, remoteWorkerVersion: null,
  remoteVersionNote: 'Reader provenance is recorded per document; exact remote Worker deployment identity is not verified by this runner.',
  limits: { documents: 20, maximumRemoteProbes: live ? 20 : 0, externalRetries: 0, concurrencyPerCompany: 1, probeTimeoutMs: 65000 },
  context: { freshOrganization: true, directProvisioning: 'Organization and owner membership only; rules, vendors, agreements and activation use original authenticated API.',
    cumulativeBudget: true, resetBetweenCases: false, localD1R2: true, localStatePath: statePath,
    queueTransport: 'Controlled in-memory transport; original durable D1 job creation, enqueue API and consumeInvoiceJobs processor.',
    originalDomainAndReservationTriggers: true, productionFinancialWrites: false, browserTested: false,
    humanReviews: 'Explicit simulated OWNER approval/rejection performed by the runner, never by the model.',
    labelsSentToReaders: false, cost: 'Usage reported by successful reader responses only; interrupted calls and separate conversion may be unreported.' },
  setup: {}, results: [], summary: null,
};
const save = () => {
  const json = JSON.stringify(report, null, 2) + '\n';
  assert.ok(!token || !json.includes(token), 'Refusing to persist reader credential');
  mkdirSync(new URL('docs/evaluations/', root), { recursive: true });
  writeFileSync(output.pathname + '.tmp', json); renameSync(output.pathname + '.tmp', output);
};
save();
const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("journey-storage")}}',
  compatibilityDate: '2026-07-30', d1Databases: { DB: `journey-${slug}-${runId}` }, r2Buckets: ['INVOICES'],
  d1Persist: statePath + '/d1', r2Persist: statePath + '/r2' });
const DB = await runtime.getD1Database('DB');
const bucket = await runtime.getR2Bucket('INVOICES');
const q = (sql, ...values) => DB.prepare(sql).bind(...values);
const org = `org_journey_${slug}_${randomUUID()}`, user = `owner_${slug}_${randomUUID()}`;
const origin = 'https://oli-journey.invalid';
const queue = [], readCache = new Map();
let probeCalls = 0, cookie = '', csrf = '';
const env = { DB, INVOICES: bucket, DEMO_ORG_ID: org, DEMO_USER_ID: user, DEMO_PASSWORD: randomUUID(),
  INVOICE_QUEUE: { send: async body => { queue.push(structuredClone(body)); } } };
const api = async (path, { method = 'GET', data, file, key, headers = {}, allowError = false } = {}) => {
  const h = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...headers };
  let body = data === undefined ? undefined : JSON.stringify(data);
  if (data !== undefined) h['Content-Type'] = 'application/json';
  if (file) { body = new FormData(); body.append('file', new Blob([file.bytes], { type: file.mimeType }), file.name); }
  if (key) h['Idempotency-Key'] = key;
  const response = await worker.fetch(new Request(origin + '/api/v1' + path, { method, headers: h, body }), env);
  const payload = response.status === 204 ? null : await response.json();
  if (!allowError) assert.ok(response.ok, JSON.stringify({ path, status: response.status, payload }));
  return { status: response.status, payload, headers: response.headers };
};
const activate = async () => {
  const state = (await api('/mandate')).payload.data;
  const draft = (await api('/mandate/draft', { method: 'PUT', data: { expectedRevision: state.draft?.revision ?? null,
    basedOnPolicyVersionId: state.active?.id ?? null, rules } })).payload.data;
  const options = { method: 'POST', key: randomUUID(), data: { draftId: draft.id, expectedRevision: draft.revision,
    expectedActivePolicyVersionId: state.active?.id ?? null, confirmed: true } };
  const activated = await api('/mandate/activate', options);
  assert.deepEqual((await api('/mandate/activate', options)).payload, activated.payload);
  return activated.payload.data;
};
const ledger = async invoiceId => ({
  reservedMinor: await q('SELECT coalesce(sum(reserved_minor),0) AS n FROM budget_periods WHERE org_id=?', org).first('n'),
  reservations: await q('SELECT count(*) AS n FROM budget_reservations WHERE org_id=?', org).first('n'),
  decisions: await q('SELECT count(*) AS n FROM decisions WHERE org_id=?', org).first('n'),
  invoiceReservations: invoiceId ? await q('SELECT count(*) AS n FROM budget_reservations WHERE org_id=? AND invoice_id=?', org, invoiceId).first('n') : 0,
});
const message = body => ({ body, acks: 0, retries: [], ack() { this.acks++; }, retry(value) { this.retries.push(value); } });
let currentScenario, currentRow;
const remoteRead = async (_env, file, bytes, digest) => {
  assert.equal(hash(bytes), digest);
  if (readCache.has(digest)) { currentRow.readerCacheHit = true; return structuredClone(readCache.get(digest)); }
  let read;
  if (replay) {
    const frozen = replay.results.find(row => row.caseId === currentScenario.id);
    assert.equal(frozen.file.sha256, digest);
    if (!frozen.read) {
      currentRow.readerError = structuredClone(frozen.readerError);
      throw new ExtractionError(frozen.readerError.code, frozen.readerError.attempts ?? [], frozen.readerError.diagnostic);
    }
    read = structuredClone(frozen.read);
    assert.equal(read.documentSha256, digest);
    ExtractedInvoiceSchema.parse(read.extraction);
    if (reparse) {
      const historicalReaderVersion = read.provenance.configVersion;
      const capture = conversions.captures.find(c => c.company === slug && c.sourceSha256 === digest);
      const pdf = file.mimeType === 'application/pdf';
      const ocr = read.provenance.imageOcr;
      if (pdf) {
        assert.ok(capture);
        assert.equal(hash(readFileSync(new URL(capture.sourceFile, root))), digest);
        assert.equal(hash(capture.text), capture.textSha256);
      } else assert.equal(ocr?.documentSha256, digest);
      // Remove only the old server-derived comparisons; all primary model warnings survive.
      const derived = new Set([...(read.provenance.independentDisagreements ?? []).map(f => `INDEPENDENT_READ_MISMATCH:${f}`),
        ...(read.provenance.independentIssues ?? [])]);
      const extraction = { ...read.extraction, extractionWarnings: read.extraction.extractionWarnings.filter(w => !derived.has(w)) };
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, init) => {
          assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
          const body = JSON.parse(init.body);
          const secondary = !pdf && body.model === ocr.model;
          return Response.json({ model: secondary ? ocr.model : read.provenance.model,
            choices: [{ finish_reason: 'stop', message: { content: secondary ? ocr.text
              : JSON.stringify({ ...extraction, documentType: read.documentType, advisories: read.provenance.advisories }) } }] });
        };
        read = await readDocument({ OPENROUTER_API_KEY: 'offline-frozen-reparse', IMAGE_OCR_MODE: 'ENABLED',
          AI: { toMarkdown: async () => ({ format: 'markdown', data: capture.text }) } }, file, bytes, digest);
        read.provenance.offlineReplay = { primaryReportSha256: hash(replayBytes),
          historicalReaderVersion, secondaryTextSha256: hash(pdf ? capture.text : ocr.text), newModelCalls: 0 };
      } finally { globalThis.fetch = originalFetch; }
    }
  } else if (synthetic) {
    const extraction = structuredClone(currentScenario.expectedExtraction);
    read = { extraction: { ...extraction, extractionWarnings: currentScenario.id === '018' ? ['SYNTHETIC_CONTRADICTORY_TOTAL'] : [], evidence: [] },
      documentType: currentScenario.expectedDocumentType ?? (currentScenario.id === '019' ? 'PAYMENT_RECEIPT' : currentScenario.id === '020' ? 'QUOTE' : 'INVOICE'),
      primaryReadId: 'synthetic-primary-' + digest, documentSha256: digest, agreementReference: null,
      corroboration: { documentSha256: digest, readId: 'synthetic-secondary-' + digest, method: 'PDF_TEXT',
        fields: Object.fromEntries(critical.map(f => [f, extraction[f]])) },
      provenance: { synthetic: true, configVersion: READER_VERSION } };
  } else {
    assert.ok(probeCalls < report.limits.maximumRemoteProbes);
    probeCalls++;
    const started = Date.now();
    const response = await fetch(target + '/api/internal/document-probe', { method: 'POST', signal: AbortSignal.timeout(65000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.mimeType }, body: bytes });
    currentRow.readerDurationMs = Date.now() - started;
    currentRow.readerHttpStatus = response.status;
    const payload = await response.json();
    if (!response.ok) {
      currentRow.readerError = payload.error;
      throw new ExtractionError(payload.error?.code ?? 'DOCUMENT_READ_FAILED', payload.error?.attempts ?? [], payload.error?.diagnostic);
    }
    read = payload.data;
    assert.equal(read.documentSha256, digest);
    ExtractedInvoiceSchema.parse(read.extraction);
  }
  readCache.set(digest, structuredClone(read));
  return read;
};

try {
  const migrations = new URL('packages/database/migrations/', root);
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
    await DB.batch(readFileSync(new URL(name, migrations), 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
  }
  await DB.batch([
    q('INSERT INTO organizations(id,name,default_currency,timezone) VALUES (?,?,?,?)', org, manifest.company.name, rules.currency, manifest.company.timezone),
    q('INSERT INTO users(id,name,email) VALUES (?,?,?)', user, `${slug} fictional owner`, `${slug}-owner@journey.invalid`),
    q("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,'OWNER')", org, user),
    q("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('foreign_org','Foreign fictional boundary','USD','UTC')"),
    q("INSERT INTO vendors(id,org_id,name,normalized_name,allowed) VALUES ('foreign_vendor','foreign_org','Foreign fictional vendor','foreign fictional vendor',1)"),
  ]);
  const login = await api('/session', { method: 'POST', data: { email: `${slug}-owner@journey.invalid`, password: env.DEMO_PASSWORD } });
  cookie = login.headers.get('Set-Cookie').split(';')[0]; csrf = login.payload.data.csrfToken;
  assert.equal(login.payload.data.organization.id, org);
  report.setup.organizationId = org;
  report.setup.initialPolicyAbsent = (await api('/mandate')).payload.data.active === null;
  const policy = await activate();
  report.setup.activatedPolicy = policy;
  const vendors = new Map();
  for (const { key, ...data } of manifest.vendors) vendors.set(key, (await api('/vendors', { method: 'POST', data })).payload.data);
  for (const { key, vendorKey, ...data } of manifest.agreements) {
    await api('/agreements', { method: 'POST', data: { ...data, vendorId: vendors.get(vendorKey).id } });
  }
  report.setup.directory = { vendors: vendors.size, agreements: manifest.agreements.length };
  report.setup.tenantMutationDenied = (await api('/vendors/foreign_vendor', { method: 'PATCH', data: { allowed: false }, allowError: true })).status === 404;
  const listed = (await api('/vendors?pageSize=100')).payload.data;
  assert.ok(!listed.some(v => v.id === 'foreign_vendor'));
  assert.ok(report.setup.initialPolicyAbsent && report.setup.tenantMutationDenied);
  report.setup.openingLedger = await ledger();
  save();
  if (live) {
    assert.equal((await fetch(target + '/api/health')).status, 200);
    assert.equal((await fetch(target + '/api/internal/document-probe', { method: 'POST' })).status, 401);
  }
  let expectedReserved = 0;
  for (const scenario of manifest.cases) {
    currentScenario = scenario;
    const row = currentRow = { caseId: scenario.id, file: scenario.file, expected: scenario.expected,
      humanAction: scenario.humanAction, expectedFinalAction: scenario.expectedFinalAction,
      expectedReservationDeltaMinor: scenario.expectedReservationDeltaMinor, startedAt: new Date().toISOString(), error: null };
    const started = Date.now();
    const callsBefore = probeCalls;
    try {
      row.before = await ledger();
      row.referenceReservedBeforeMinor = expectedReserved;
      row.referenceContextDiverged = row.before.reservedMinor !== expectedReserved;
      const file = { bytes: documents.get(scenario.id), mimeType: scenario.file.mimeType, name: scenario.file.path.split('/').at(-1) };
      const uploadOptions = { method: 'POST', key: randomUUID(), file };
      const uploaded = await api('/invoices', uploadOptions);
      assert.equal(uploaded.status, 201);
      row.invoiceId = uploaded.payload.data.id;
      assert.deepEqual((await api('/invoices', uploadOptions)).payload, uploaded.payload);
      row.uploadReplay = true;
      const process = await api(`/invoices/${row.invoiceId}/process`, { method: 'POST' });
      assert.ok([200, 202].includes(process.status));
      const body = queue.shift(); assert.ok(body);
      const callback = (environment, organization, invoice) => {
        assert.equal(invoice, row.invoiceId, 'A queued invoice must belong to the active scenario');
        return processInvoice(environment, organization, invoice, remoteRead);
      };
      const first = message(body), duplicate = message(body);
      // Concurrent delivery exercises the original lease fencing; only one consumer may read the document.
      await Promise.all([consumeInvoiceJobs({ messages: [first] }, env, callback), consumeInvoiceJobs({ messages: [duplicate] }, env, callback)]);
      let detail = InvoiceDetailSchema.parse((await api('/invoices/' + row.invoiceId)).payload.data);
      row.initialDecision = detail.latestDecision;
      row.initialStatus = detail.status;
      const stored = await q('SELECT extracted_json FROM invoices WHERE org_id=? AND id=?', org, row.invoiceId).first('extracted_json');
      row.read = stored ? JSON.parse(stored) : null;
      row.matchingFields = row.read ? fields.filter(f => row.read.extraction[f] === scenario.expectedExtraction[f]) : [];
      row.mismatches = fields.filter(f => !row.matchingFields.includes(f)).map(f => ({ field: f, expected: scenario.expectedExtraction[f], actual: row.read?.extraction[f] ?? null }));
      row.initialCorrect = detail.latestDecision?.action === scenario.expected.action
        && scenario.expected.requiredReasons.every(r => detail.latestDecision.reasons.includes(r))
        && detail.latestDecision.needsHumanApproval === scenario.expected.needsHumanApproval;
      if (scenario.humanAction && detail.approvalRequest?.state === 'PENDING') {
        if (scenario.humanAction === 'APPROVE') {
          const obsolete = detail;
          await activate();
          const stale = await api(`/approvals/${obsolete.approvalRequest.id}/decision`, { method: 'POST', key: randomUUID(), allowError: true,
            data: { action: 'APPROVE', comment: 'Simulated stale approval must fail', expectedDecisionId: obsolete.latestDecision.id,
              expectedPolicyVersionId: obsolete.latestDecision.policyVersionId } });
          assert.equal(stale.status, 409); row.stalePolicyApprovalDenied = true;
          const active = (await api('/mandate')).payload.data.active;
          detail = (await api(`/invoices/${row.invoiceId}/reevaluate`, { method: 'POST', key: randomUUID(),
            data: { expectedDecisionId: obsolete.latestDecision.id, expectedPolicyVersionId: active.id } })).payload.data;
        }
        if (detail.approvalRequest?.state === 'PENDING' && detail.latestDecision.needsHumanApproval) {
          const reviewOptions = { method: 'POST', key: randomUUID(), data: { action: scenario.humanAction,
            comment: `Explicit fictional OWNER ${scenario.humanAction.toLowerCase()} for journey ${scenario.id}`,
            expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId } };
          const reviewed = await api(`/approvals/${detail.approvalRequest.id}/decision`, reviewOptions);
          assert.deepEqual((await api(`/approvals/${detail.approvalRequest.id}/decision`, reviewOptions)).payload, reviewed.payload);
          row.humanReviewReplay = true;
        }
      }
      detail = InvoiceDetailSchema.parse((await api('/invoices/' + row.invoiceId)).payload.data);
      row.detail = detail;
      row.after = await ledger(row.invoiceId);
      row.finalCorrect = detail.latestDecision?.action === scenario.expectedFinalAction;
      row.reservationDeltaMatchesReference = row.after.reservedMinor - row.before.reservedMinor === scenario.expectedReservationDeltaMinor;
      const approved = detail.latestDecision?.action === 'APPROVE';
      row.unexpectedApproval = approved && scenario.expectedFinalAction !== 'APPROVE';
      row.unsafeApprovalReasons = [];
      if (approved) {
        if (row.matchingFields.length !== fields.length) row.unsafeApprovalReasons.push('APPROVED_FACTS_DIFFER_FROM_REFERENCE');
        if (detail.amountMinor > rules.hardLimitMinor || detail.currency !== rules.currency) row.unsafeApprovalReasons.push('HARD_POLICY_VIOLATION');
        if (detail.amountMinor > rules.monthlyBudgetMinor - row.before.reservedMinor) row.unsafeApprovalReasons.push('ACTUAL_BUDGET_EXCEEDED');
        if (detail.amountMinor > Math.min(rules.automaticLimitMinor, rules.reviewAboveMinor)
          && !(scenario.humanAction === 'APPROVE' && row.humanReviewReplay && detail.latestDecision.actor.kind === 'HUMAN')) {
          row.unsafeApprovalReasons.push('HUMAN_AUTHORITY_MISSING');
        }
        const vendor = manifest.vendors.find(v => v.name === scenario.expectedExtraction.vendorName);
        if (!vendor?.allowed) row.unsafeApprovalReasons.push('REFERENCE_VENDOR_NOT_ALLOWED');
        const agreements = manifest.agreements.filter(a => a.vendorKey === vendor?.key && a.active
          && a.concept === scenario.expectedExtraction.description && a.currency === scenario.expectedExtraction.currency
          && Math.abs(a.amountMinor - scenario.expectedExtraction.amountMinor) <= a.toleranceMinor);
        if (agreements.length !== 1) row.unsafeApprovalReasons.push('REFERENCE_AGREEMENT_NOT_UNIQUE_OR_COMPATIBLE');
        const activePolicy = await q("SELECT id FROM policy_versions WHERE org_id=? AND status='ACTIVE'", org).first('id');
        if (detail.latestDecision.policyVersionId !== activePolicy) row.unsafeApprovalReasons.push('APPROVED_POLICY_NOT_CURRENT');
        const onlyReferenceBudgetDiverged = scenario.expected.requiredReasons.length > 0
          && scenario.expected.requiredReasons.every(reason => reason === 'BUDGET_EXCEEDED');
        if (row.unexpectedApproval && !(row.referenceContextDiverged && onlyReferenceBudgetDiverged)) {
          row.unsafeApprovalReasons.push('REFERENCE_FORBIDS_APPROVAL');
        }
      }
      row.unsafeApproval = row.unsafeApprovalReasons.length > 0;
      assert.equal(row.after.invoiceReservations, approved ? 1 : 0);
      assert.equal(row.after.reservedMinor - row.before.reservedMinor, approved ? detail.amountMinor : 0);
      assert.ok(row.after.reservedMinor <= rules.monthlyBudgetMinor);
      const replay = message(body);
      await consumeInvoiceJobs({ messages: [replay] }, env, () => assert.fail('A completed job cannot call readers again'));
      assert.deepEqual(await ledger(row.invoiceId), row.after);
      await api(`/invoices/${row.invoiceId}/process`, { method: 'POST' });
      assert.deepEqual(await ledger(row.invoiceId), row.after);
      row.processingReplay = true;
      const fileResponse = await worker.fetch(new Request(origin + detail.file.url, { headers: { Cookie: cookie } }), env);
      assert.equal(fileResponse.status, 200); assert.equal(hash(new Uint8Array(await fileResponse.arrayBuffer())), scenario.file.sha256);
      assert.equal((await worker.fetch(new Request(origin + detail.file.url), env)).status, 401);
      row.privateDocumentVerified = true;
      row.job = await q('SELECT state,attempts,last_error_json FROM invoice_jobs WHERE org_id=? AND invoice_id=?', org, row.invoiceId).first();
      row.correct = !!row.initialCorrect && !!row.finalCorrect && row.reservationDeltaMatchesReference;
    } catch (error) {
      row.error = { name: error.name, message: String(error.message).slice(0, 1800) };
      row.correct = false;
    }
    expectedReserved += scenario.expectedReservationDeltaMinor;
    row.remoteProbeCalls = probeCalls - callsBefore;
    row.durationMs = Date.now() - started;
    report.results.push(row); save();
    console.log(JSON.stringify({ company: slug, completed: report.results.length, case: scenario.id,
      action: row.initialDecision?.action, final: row.detail?.latestDecision?.action, correct: row.correct,
      unsafeApproval: row.unsafeApproval, durationMs: row.durationMs, error: row.error?.message ?? row.readerError?.code }));
    if (row.error) {
      report.aborted = { caseId: scenario.id, reason: 'HARNESS_ERROR',
        unattemptedCaseIds: manifest.cases.slice(report.results.length).map(c => c.id) };
      break;
    }
  }
  report.finalLedger = await ledger();
  report.dashboard = (await api('/dashboard')).payload.data;
  report.setup.sessionLogout = (await api('/session', { method: 'DELETE' })).status === 204;
  report.setup.sessionRevoked = (await api('/me', { allowError: true })).status === 401;
  report.sourceUnchanged = JSON.stringify(sourceHashes()) === JSON.stringify(report.sourceHashes);
  report.manifestUnchanged = hash(readFileSync(new URL('manifest.json', fixtureRoot))) === report.manifestSha256;
  const rows = report.results;
  const times = rows.map(r => r.durationMs).sort((a, b) => a - b);
  const returned = rows.filter(r => r.read);
  report.summary = { attempted: rows.length, decided: rows.filter(r => r.initialDecision).length,
    fullyCorrect: rows.filter(r => r.correct).length, unsafeApprovals: rows.filter(r => r.unsafeApproval).length,
    unexpectedApprovals: rows.filter(r => r.unexpectedApproval).length,
    contextDivergences: rows.filter(r => r.referenceContextDiverged).length,
    harnessErrors: rows.filter(r => r.error).length, readerFailures: rows.filter(r => r.readerError).length,
    allEightFieldsExact: rows.filter(r => r.matchingFields?.length === fields.length).length,
    correctAutonomous: rows.filter(r => r.initialCorrect && ['APPROVE', 'BLOCK'].includes(r.initialDecision?.action)).length,
    explainedDecisions: rows.filter(r => r.initialDecision?.humanExplanation && r.initialDecision.trace?.length).length,
    approved: rows.filter(r => r.detail?.latestDecision?.action === 'APPROVE').length,
    blocked: rows.filter(r => r.detail?.latestDecision?.action === 'BLOCK').length,
    escalated: rows.filter(r => r.detail?.latestDecision?.action === 'ESCALATE').length,
    explicitHumanReviews: rows.filter(r => r.humanReviewReplay).length,
    uploadReplays: rows.filter(r => r.uploadReplay).length, processingReplays: rows.filter(r => r.processingReplay).length,
    privateDocumentsVerified: rows.filter(r => r.privateDocumentVerified).length,
    remoteProbeCalls: probeCalls, readerCacheHits: rows.filter(r => r.readerCacheHit).length,
    medianDurationMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null,
    maxDurationMs: times.at(-1) ?? null,
    readerVersions: [...new Set(returned.map(r => r.read.provenance?.configVersion ?? null))],
    successfulPrimaryReportedCostUsd: returned.filter(r => !r.readerCacheHit).reduce((n, r) => n + (r.read.provenance?.usage?.costUsd ?? 0), 0),
    successfulSecondaryReportedCostUsd: returned.filter(r => !r.readerCacheHit).reduce((n, r) => n + (r.read.provenance?.imageOcr?.usage?.costUsd ?? 0), 0),
    selfTest: synthetic, frozenReaderReplay: !!replay, reparsedSecondaryText: reparse,
    newModelCalls: live ? null : 0 };
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ output: output.pathname, summary: report.summary }));
  if (report.summary.unsafeApprovals || report.summary.harnessErrors || !report.sourceUnchanged || !report.manifestUnchanged) process.exitCode = 1;
  if (synthetic && report.summary.fullyCorrect !== 20) process.exitCode = 1;
} catch (error) {
  report.fatalError = { name: error.name, message: String(error.message).slice(0, 1800) };
  report.finishedAt = new Date().toISOString(); save(); throw error;
} finally { await runtime.dispose(); }

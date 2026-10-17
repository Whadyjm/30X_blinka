import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { ExtractedInvoiceSchema, InvoiceDetailSchema, checkExtraction } from '@oli/contracts';
import { evaluateInvoice, normalizeInvoiceNumber } from '@oli/domain';
import { ExtractionError } from '@oli/extraction';
import worker from '../worker/index.js';
import { processInvoice, decisionStatements } from '../worker/processing.js';
import { normalizeName, periodKey } from '../worker/http.js';

assert.equal(process.argv[2], '--run', 'Pass --run to evaluate the 50 PDFs with paid production readers');
const root = new URL('../../../', import.meta.url);
const corpusBytes = readFileSync(new URL('fixtures/scenarios/invoices.json', root));
const corpus = JSON.parse(corpusBytes);
const seed = JSON.parse(readFileSync(new URL('fixtures/seed/company.json', root)));
const imageReplayPath = process.argv[3]?.match(/^--image-replay=(docs\/evaluations\/image-readers-[\w.-]+\.json)$/)?.[1];
const imageReplay = imageReplayPath ? JSON.parse(readFileSync(new URL(imageReplayPath, root))) : null;
if (imageReplay) assert.equal(imageReplay.scope, 'REAL_REMOTE_IMAGE_READERS_AND_LOCAL_COMPARISON_ONLY');
const token = imageReplay ? 'offline-replay-only-no-network' : readFileSync(new URL('.env.extraction-probe', root), 'utf8').trim();
assert.ok(imageReplay || token.length >= 32);
assert.equal(corpus.cases.length, 50);
const selection = process.argv[3]?.match(/^--cases=(case_\d{3}(?:,case_\d{3})*)$/)?.[1].split(',');
assert.ok(!process.argv[3] || selection || imageReplay, 'Optional: --cases=case_010,case_014 or --image-replay=docs/evaluations/image-readers-....json');
assert.equal(process.argv.length <= 4, true);
assert.ok(!selection || selection.every(id => corpus.cases.some(c => c.id === id)));
const scenarios = imageReplay ? corpus.cases.filter(c => c.variants.some(v => v.mimeType === 'image/png'))
  .map(c => ({ ...c, file: c.variants.find(v => v.mimeType === 'image/png') }))
  : corpus.cases.filter(c => !selection || selection.includes(c.id));
assert.equal(periodKey(seed.organization.timezone), corpus.evaluationTime.slice(0, 7), 'Corpus contexts must match current processing month; do not silently change labels');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const scenario of scenarios) {
  assert.match(scenario.file.path, /^invoices\/\d{3}\.(pdf|png)$/);
  assert.equal(hash(readFileSync(new URL('fixtures/' + scenario.file.path, root))), scenario.file.sha256);
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const statePath = resolve(new URL('../.wrangler/corpus/' + runId, import.meta.url).pathname);
mkdirSync(statePath, { recursive: true });
const output = new URL(`docs/evaluations/invoices-${imageReplay ? 'image-replay' : 'pdf'}-${runId}.json`, root);
const base = 'https://oli-api.tiamat-agency.workers.dev';
const origin = 'https://oli-evaluation.invalid';
const report = { runId, startedAt: new Date().toISOString(), finishedAt: null,
  scope: imageReplay ? 'FROZEN_REAL_IMAGE_READS_LOCAL_API_PROCESSING_D1_R2' : 'REAL_PDF_READERS_LOCAL_API_PROCESSING_D1_R2', safetyGate: 'Any approved invoice must match all eight reference fields and expected action', datasetVersion: corpus.datasetVersion,
  selection: imageReplay ? 'TEN_PNG_VARIANTS' : selection ?? 'ALL_50',
  manifestSha256: hash(corpusBytes), target: imageReplay ? 'LOCAL_ISOLATED_D1_R2' : base, remoteWorkerVersion: imageReplay?.workerVersion ?? process.env.EVALUATION_WORKER_VERSION ?? null,
  code: Object.fromEntries(['apps/api/worker/document.js', 'apps/api/worker/processing.js', 'packages/extraction/src/openrouter.ts', 'packages/domain/src/index.ts']
    .map(path => [path, hash(readFileSync(new URL(path, root)))])),
  limits: { documents: scenarios.length, concurrency: selection || imageReplay ? 1 : 2, maximumModelCalls: imageReplay ? 0 : scenarios.length * 3, retriesPerDocument: 0 },
  context: { perCaseIsolatedD1: true, productionDatabaseWrites: false, persistedLocalState: statePath,
    priorInvoices: 'Labelled synthetic historical context, not newly measured OCR',
    openingReservedBudget: 'Established with explicit synthetic fixture decisions and the original D1 reservation triggers; no counter edits',
    clock: 'Current API clock; corpus evaluationTime belongs to the same budget month',
    processingEntry: imageReplay ? 'Original processInvoice with frozen real image reads; no fresh provider calls. Upload/detail/private document APIs and atomic reservation triggers are exercised locally.'
      : 'Original processInvoice service with a server-only adapter to the authenticated remote readDocument probe; upload/detail/document APIs unchanged',
    browser: 'Not run for all 50; API details and private document bytes verified',
    cost: imageReplay ? 'No new provider calls; sourceReaderReportedCostUsd refers only to the original source report, not another charge.' : 'Reported successful responses only; excludes failed/interrupted calls and possibly separately billed PDF conversion',
    imageReplay: imageReplay ? { source: imageReplayPath, sha256: hash(readFileSync(new URL(imageReplayPath, root))),
      remoteWorkerVersion: imageReplay.workerVersion, mode: 'Only the server-owned shadow warning is removed in isolated local processing; other warnings remain.' } : null },
  results: [], summary: null };
const save = () => { const serialized = JSON.stringify(report, null, 2) + '\n'; assert.equal(serialized.includes(token), false); writeFileSync(output, serialized); };
save();
const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated-evaluation")}}',
  compatibilityDate: '2026-07-30', d1Persist: statePath + '/d1', r2Persist: statePath + '/r2',
  d1Databases: Object.fromEntries(scenarios.map(c => [c.id, `corpus-${runId}-${c.id}`])), r2Buckets: ['INVOICES'] });
const bucket = await runtime.getR2Bucket('INVOICES');
const migrationRoot = new URL('packages/database/migrations/', root);
const migrations = readdirSync(migrationRoot).filter(f => f.endsWith('.sql')).sort()
  .flatMap(f => readFileSync(new URL(f, migrationRoot), 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()));
const fields = ['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'servicePeriod', 'description'];
const critical = ['vendorName', 'amountMinor', 'currency', 'dueDate'];
async function prepare(db, scenario) {
  for (let offset = 0; offset < migrations.length; offset += 40) await db.batch(migrations.slice(offset, offset + 40).map(sql => db.prepare(sql)));
  const org = seed.organization.id;
  const user = seed.policy.activatedBy;
  const rules = { ...seed.policy.rules, ...scenario.context.policyRulesOverride };
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  await db.batch([
    q('INSERT INTO organizations(id,name,default_currency,timezone) VALUES (?,?,?,?)', org, seed.organization.name, seed.organization.defaultCurrency, seed.organization.timezone),
    q('INSERT INTO users(id,name,email) VALUES (?,?,?)', user, 'Corpus evaluation owner', 'corpus-owner@oli-demo.invalid'),
    q("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,'OWNER')", org, user),
    q("INSERT INTO policy_versions(id,org_id,version,status,policy_json,created_by) VALUES (?,?,1,'ACTIVE',?,?)", seed.policy.id, org, JSON.stringify(rules), user),
    ...seed.vendors.map(v => q('INSERT INTO vendors(id,org_id,name,normalized_name,allowed,external_ref) VALUES (?,?,?,?,?,?)', v.id, org, v.name, normalizeName(v.name), Number(v.allowed), v.externalRef)),
    ...seed.agreements.map(a => q('INSERT INTO agreements(id,org_id,vendor_id,currency,amount_minor,tolerance_minor,frequency,concept,active) VALUES (?,?,?,?,?,?,?,?,?)', a.id, org, a.vendorId, a.currency, a.amountMinor, a.toleranceMinor, a.frequency, a.concept, Number(a.active))),
  ]);
  const budget = scenario.context.budget;
  if (budget) await q('INSERT INTO budget_periods(id,org_id,currency,period_key,limit_minor) VALUES (?,?,?,?,?)', budget.id, org, budget.currency, budget.periodKey, budget.limitMinor).run();
  const insertHistorical = async (invoiceId, sha, ex, vendorId, agreementId, storedRead, fileName = 'historical-context.pdf') => {
    await q(`INSERT INTO invoices(id,org_id,vendor_id,agreement_id,vendor_name,invoice_no,normalized_invoice_no,amount_minor,currency,issued_at,due_date,service_period,description,
      file_key,file_name,file_mime_type,file_size_bytes,file_sha256,extracted_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'application/pdf',1,?,?)`, invoiceId, org, vendorId, agreementId, ex.vendorName, ex.invoiceNumber, normalizeInvoiceNumber(ex.invoiceNumber),
    ex.amountMinor, ex.currency, ex.issuedAt, ex.dueDate, ex.servicePeriod, ex.description, `${runId}/${scenario.id}/${invoiceId}`, fileName, sha, JSON.stringify(storedRead)).run();
  };
  // Explicit historical fixtures make the opening ledger internally consistent. They are not extractor results.
  let remaining = budget?.reservedMinor ?? 0;
  let index = 0;
  if (remaining) await q("INSERT INTO vendors(id,org_id,name,normalized_name,allowed) VALUES ('baseline_vendor',?,'Opening ledger fixture','opening ledger fixture',1)", org).run();
  while (remaining > 0) {
    const amount = Math.min(remaining, rules.automaticLimitMinor, rules.reviewAboveMinor);
    assert.ok(amount > 0);
    const identifier = `baseline_${++index}`;
    const agreementId = `agreement_${identifier}`;
    const ex = { vendorName: 'Opening ledger fixture', invoiceNumber: identifier, amountMinor: amount, currency: budget.currency,
      issuedAt: '2026-10-01', dueDate: '2026-10-15', servicePeriod: budget.periodKey, description: identifier, extractionWarnings: [], evidence: [] };
    await q("INSERT INTO agreements(id,org_id,vendor_id,currency,amount_minor,tolerance_minor,frequency,concept,active) VALUES (?,?,'baseline_vendor',?,?,0,'ONE_TIME',?,1)", agreementId, org, budget.currency, amount, identifier).run();
    const sha = hash(`${scenario.id}:${identifier}`);
    const storedRead = { extraction: ex, primaryReadId: 'fixture_primary_' + identifier, documentSha256: sha,
      corroboration: { documentSha256: sha, readId: 'fixture_secondary_' + identifier, method: 'PDF_TEXT', fields: Object.fromEntries(critical.map(f => [f, ex[f]])) },
      provenance: { syntheticHistoricalContext: true, measuredExtractorResult: false } };
    await insertHistorical(identifier, sha, ex, 'baseline_vendor', agreementId, storedRead);
    const currentReserved = budget.reservedMinor - remaining;
    const evaluation = evaluateInvoice({ id: identifier, documentSha256: sha, primaryReadId: storedRead.primaryReadId, extraction: ex,
      corroboration: storedRead.corroboration, agreementReference: agreementId }, {
      organizationId: org, decisionId: 'decision_' + identifier, checkedAt: corpus.evaluationTime, budgetPeriodKey: budget.periodKey,
      policy: { ...seed.policy, rules }, vendors: [{ id: 'baseline_vendor', name: ex.vendorName, allowed: true, externalRef: null, createdAt: corpus.evaluationTime }],
      agreements: [{ id: agreementId, vendorId: 'baseline_vendor', currency: budget.currency, amountMinor: amount, toleranceMinor: 0, frequency: 'ONE_TIME', concept: identifier, active: true, createdAt: corpus.evaluationTime }],
      budget: { ...budget, reservedMinor: currentReserved, availableMinor: budget.limitMinor - currentReserved }, priorInvoices: [] });
    assert.equal(evaluation.candidate.action, 'APPROVE');
    await db.batch(decisionStatements(db, org, evaluation, storedRead));
    remaining -= amount;
  }
  for (const prior of scenario.context.priorInvoices) {
    const resolved = seed.agreements.filter(a => a.vendorId === prior.vendorId && a.concept === prior.extraction.description && a.currency === prior.extraction.currency);
    await insertHistorical(prior.invoiceId, prior.sha256, prior.extraction, prior.vendorId, resolved.length === 1 ? resolved[0].id : null,
      { extraction: prior.extraction, documentSha256: prior.sha256, primaryReadId: 'historical_fixture', corroboration: null, provenance: { syntheticHistoricalContext: true } });
  }
  const reserved = await q('SELECT coalesce(sum(reserved_minor),0) AS n FROM budget_periods').first('n');
  assert.equal(reserved, budget?.reservedMinor ?? 0);
  return { org, user, q };
}
const prepared = new Map();
async function evaluateCase(scenario) {
  const row = { caseId: scenario.id, group: scenario.group, label: scenario.label, file: scenario.file, expected: scenario.expected,
    expectedResolution: scenario.expectedResolution, startedAt: new Date().toISOString(), durationMs: null, error: null };
  const started = Date.now();
  try {
    const DB = await runtime.getD1Database(scenario.id);
    const { org, user, q } = prepared.get(scenario.id);
    const env = { DB, INVOICES: bucket, DEMO_ORG_ID: org, DEMO_USER_ID: user, DEMO_PASSWORD: randomUUID() };
    let cookie = '', csrf = '';
    const api = async (path, { method = 'GET', data, body, headers = {} } = {}) => {
      const response = await worker.fetch(new Request(origin + '/api/v1' + path, { method, body: data === undefined ? body : JSON.stringify(data),
        headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }), env);
      const payload = response.status === 204 ? null : await response.json();
      assert.ok(response.ok, JSON.stringify({ path, status: response.status, payload }));
      return { response, payload };
    };
    const login = await api('/session', { method: 'POST', data: { email: 'corpus-owner@oli-demo.invalid', password: env.DEMO_PASSWORD } });
    cookie = login.response.headers.get('Set-Cookie').split(';')[0]; csrf = login.payload.data.csrfToken;
    const bytes = readFileSync(new URL('fixtures/' + scenario.file.path, root));
    const form = new FormData(); form.append('file', new Blob([bytes], { type: scenario.file.mimeType }), scenario.file.path.split('/').at(-1));
    const uploaded = (await api('/invoices', { method: 'POST', body: form, headers: { 'Idempotency-Key': randomUUID() } })).payload.data;
    row.invoiceId = uploaded.id;
    row.openingLedger = { reservedMinor: await q('SELECT coalesce(sum(reserved_minor),0) AS n FROM budget_periods').first('n'),
      reservations: await q('SELECT count(*) AS n FROM budget_reservations').first('n'), decisions: await q('SELECT count(*) AS n FROM decisions').first('n') };
    let measuredRead = null;
    const remoteRead = async (_env, file, actualBytes, expectedHash) => {
      assert.equal(hash(actualBytes), scenario.file.sha256);
      if (imageReplay) {
        const source = imageReplay.results.find(r => r.caseId === scenario.id);
        assert.ok(source && !source.error && source.enabledRead, 'Missing successful frozen reader result');
        assert.equal(source.file.sha256, expectedHash);
        measuredRead = structuredClone(source.enabledRead);
        assert.equal(measuredRead.documentSha256, expectedHash);
        row.readDurationMs = 0;
        return measuredRead;
      }
      const readStart = Date.now();
      const response = await fetch(base + '/api/internal/document-probe', { method: 'POST', signal: AbortSignal.timeout(65000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.mimeType }, body: actualBytes });
      row.readDurationMs = Date.now() - readStart; row.readHttpStatus = response.status;
      const payload = await response.json();
      if (!response.ok) { row.readError = payload.error; throw new ExtractionError(payload.error?.code ?? 'DOCUMENT_READ_FAILED', payload.error?.attempts ?? [], payload.error?.diagnostic); }
      measuredRead = payload.data;
      assert.equal(measuredRead.documentSha256, expectedHash);
      ExtractedInvoiceSchema.parse(measuredRead.extraction);
      return measuredRead;
    };
    await processInvoice(env, org, uploaded.id, remoteRead);
    const detail = InvoiceDetailSchema.parse((await api('/invoices/' + uploaded.id)).payload.data);
    row.detail = detail;
    row.read = measuredRead;
    if (measuredRead) {
      const actual = measuredRead.extraction;
      row.expectedExtraction = scenario.expectedExtraction;
      row.matchingFields = fields.filter(f => actual[f] === scenario.expectedExtraction[f]);
      row.mismatches = fields.filter(f => !row.matchingFields.includes(f)).map(f => ({ field: f, expected: scenario.expectedExtraction[f], actual: actual[f] }));
      row.criticalExact = critical.every(f => row.matchingFields.includes(f));
      row.extractionCheck = checkExtraction({ documentSha256: measuredRead.documentSha256, primaryReadId: measuredRead.primaryReadId, candidate: actual, corroboration: measuredRead.corroboration });
    }
    row.finalLedger = { reservedMinor: await q('SELECT coalesce(sum(reserved_minor),0) AS n FROM budget_periods').first('n'),
      reservations: await q('SELECT count(*) AS n FROM budget_reservations').first('n'), decisions: await q('SELECT count(*) AS n FROM decisions').first('n'),
      invoiceReservations: await q('SELECT count(*) AS n FROM budget_reservations WHERE invoice_id=?', uploaded.id).first('n') };
    const decision = detail.latestDecision;
    row.actionMatches = decision?.action === scenario.expected.action;
    row.reasonsMatch = !!decision && scenario.expected.requiredReasons.every(r => decision.reasons.includes(r));
    row.humanApprovalMatches = !!decision && decision.needsHumanApproval === scenario.expected.needsHumanApproval;
    row.correct = row.actionMatches && row.reasonsMatch && row.humanApprovalMatches;
    row.unsafeApproval = decision?.action === 'APPROVE' && (scenario.expected.action !== 'APPROVE' || row.matchingFields?.length !== fields.length);
    const reservationDelta = decision?.action === 'APPROVE' ? detail.amountMinor : 0;
    assert.equal(row.finalLedger.reservedMinor - row.openingLedger.reservedMinor, reservationDelta);
    assert.equal(row.finalLedger.reservations - row.openingLedger.reservations, decision?.action === 'APPROVE' ? 1 : 0);
    assert.equal(row.finalLedger.invoiceReservations, decision?.action === 'APPROVE' ? 1 : 0);
    row.idempotentReplay = false;
    if (detail.status === 'DECIDED') {
      await processInvoice(env, org, uploaded.id, async () => assert.fail('Decided invoice must not spend another provider call'));
      assert.equal(await q('SELECT count(*) AS n FROM decisions').first('n'), row.finalLedger.decisions);
      assert.equal(await q('SELECT coalesce(sum(reserved_minor),0) AS n FROM budget_periods').first('n'), row.finalLedger.reservedMinor);
      row.idempotentReplay = true;
    }
    const fileResponse = await worker.fetch(new Request(origin + detail.file.url, { headers: { Cookie: cookie } }), env);
    assert.equal(fileResponse.status, 200); assert.equal(hash(new Uint8Array(await fileResponse.arrayBuffer())), scenario.file.sha256);
    row.privateDocumentMatches = true;
  } catch (error) { row.error = { name: error.name, message: String(error.message).slice(0, 2000) }; }
  row.durationMs = Date.now() - started;
  report.results.push(row); report.results.sort((a, b) => a.caseId.localeCompare(b.caseId)); save();
  console.log(JSON.stringify({ completed: report.results.length, total: scenarios.length, caseId: row.caseId, status: row.detail?.status, action: row.detail?.latestDecision?.action,
    expected: scenario.expected.action, correct: row.correct, warnings: row.read?.extraction.extractionWarnings.length, model: row.read?.provenance.model,
    durationMs: row.durationMs, error: row.error?.message ?? row.readError?.code }));
}
try {
  // Validate every isolated context before spending any model calls.
  for (const scenario of scenarios) prepared.set(scenario.id, await prepare(await runtime.getD1Database(scenario.id), scenario));
  console.log(JSON.stringify({ preparedContexts: prepared.size, paidCallsStarted: 0 }));
  if (!imageReplay) {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/internal/document-probe', { method: 'POST' })).status, 401);
  }
  let next = 0;
  await Promise.all(Array.from({ length: report.limits.concurrency }, async () => {
    while (next < scenarios.length) await evaluateCase(scenarios[next++]);
  }));
  const rows = report.results;
  const returned = rows.filter(r => r.read);
  const decided = rows.filter(r => r.detail?.latestDecision);
  const times = rows.map(r => r.durationMs).sort((a,b) => a-b);
  report.finishedAt = new Date().toISOString();
  report.summary = { attempted: rows.length, returnedExtractions: returned.length, technicalFailures: rows.filter(r => r.detail?.status === 'FAILED').length,
    documentTypes: Object.fromEntries(['INVOICE','PAYMENT_RECEIPT','DELIVERY_NOTE','QUOTE','CREDIT_NOTE','OTHER','UNKNOWN'].map(kind => [kind, returned.filter(r => r.read.documentType === kind).length])),
    harnessErrors: rows.filter(r => r.error).length, decided: decided.length, actions: Object.fromEntries(['APPROVE','BLOCK','ESCALATE'].map(a => [a, decided.filter(r => r.detail.latestDecision.action === a).length])),
    allEightFieldsExact: returned.filter(r => r.matchingFields.length === fields.length).length,
    criticalFieldsExact: returned.filter(r => r.criticalExact).length,
    fieldMatches: Object.fromEntries(fields.map(f => [f, { exact: returned.filter(r => r.matchingFields.includes(f)).length, attempted: rows.length, returned: returned.length }])),
    crossChecked: rows.filter(r => r.extractionCheck?.status === 'CROSS_CHECKED').length,
    withWarnings: returned.filter(r => r.read.extraction.extractionWarnings.length).length,
    actionMatches: rows.filter(r => r.actionMatches).length, fullyCorrect: rows.filter(r => r.correct).length,
    unsafeApprovals: rows.filter(r => r.unsafeApproval).length,
    correctAutonomous: rows.filter(r => r.correct && r.detail.latestDecision.action !== 'ESCALATE').length,
    explainedDecisions: decided.filter(r => r.detail.latestDecision.humanExplanation && r.detail.latestDecision.trace.length).length,
    decisionAccuracy: rows.filter(r => r.correct).length / rows.length,
    correctAutonomy: rows.filter(r => r.correct && r.detail.latestDecision.action !== 'ESCALATE').length / rows.length,
    medianDurationMs: times.length % 2 ? times[Math.floor(times.length / 2)] : (times[times.length / 2 - 1] + times[times.length / 2])/2, maxDurationMs: times.at(-1),
    successfulResponsesReportedCostUsd: imageReplay ? 0 : returned.reduce((sum,r) => sum + (r.read.provenance.usage?.costUsd ?? 0),0),
    sourceReaderReportedCostUsd: imageReplay ? returned.reduce((sum,r) => sum + (r.read.provenance.usage?.costUsd ?? 0) + (r.read.provenance.imageOcr?.usage?.costUsd ?? 0),0) : null,
    successfulModels: Object.fromEntries([...new Set(returned.map(r => r.read.provenance.model))].map(m => [m, returned.filter(r => r.read.provenance.model === m).length])) };
  save(); console.log(JSON.stringify({ output: output.pathname, summary: report.summary }, null, 2));
  if(report.summary.harnessErrors || report.summary.unsafeApprovals || report.summary.fullyCorrect !== scenarios.length || returned.some(r => r.read.documentType !== 'INVOICE'))process.exitCode=1;
} finally { await runtime.dispose(); }

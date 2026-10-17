import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkExtraction } from '@oli/contracts';
import { parsePdfText } from '../worker/document.js';

assert.deepEqual(process.argv.slice(2), ['--run'], 'Explicit --run required: 27 synthetic images, at most 108 model calls');
const root = new URL('../../../', import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const corpus = load('fixtures/scenarios/invoices.json'), additional = load('docs/fixtures/invoice-holdout/manifest.json');
const challenge = load('docs/fixtures/image-ocr/manifest.json');
// Unknown critical facts require reading review; a correctly read similar vendor name is a business-identity check.
const missingCritical = ex => ['vendorName', 'amountMinor', 'currency', 'dueDate'].some(field => ex[field] === null);
const scenarios = [
  ...corpus.cases.flatMap(c => c.variants.filter(v => v.mimeType === 'image/png').map(file => ({ ...c, file,
    path: 'fixtures/' + file.path, set: 'ORIGINAL_TEN', mustRequireReadingReview: missingCritical(c.expectedExtraction) }))),
  ...additional.cases.filter(c => c.file.mimeType === 'image/png').map(c => ({ ...c, path: 'docs/fixtures/invoice-holdout/' + c.file.path,
    set: 'PRIOR_LAYOUTS', mustRequireReadingReview: c.id === 'holdout_005' })),
  ...challenge.cases.map(c => ({ ...c, path: 'docs/fixtures/image-ocr/' + c.file.path, set: 'NEW_CHALLENGE' })),
];
assert.equal(scenarios.length, 27);
assert.equal(challenge.synthetic, true);
for (const scenario of scenarios) assert.equal(hash(readFileSync(new URL(scenario.path, root))), scenario.file.sha256);
const token = readFileSync(new URL('.env.extraction-probe', root), 'utf8').trim(); assert.ok(token.length >= 32);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = new URL('docs/evaluations/image-readers-' + runId + '.json', root);
const fields = ['vendorName','invoiceNumber','amountMinor','currency','issuedAt','dueDate','servicePeriod','description'];
const report = { runId, startedAt: new Date().toISOString(), finishedAt: null,
  scope: 'REAL_REMOTE_IMAGE_READERS_AND_LOCAL_COMPARISON_ONLY', target: 'https://oli-api.tiamat-agency.workers.dev',
  workerVersion: process.env.EVALUATION_WORKER_VERSION ?? null,
  localCommit: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  code: Object.fromEntries(['apps/api/worker/document.js','packages/extraction/src/openrouter.ts','apps/api/scripts/evaluate-image-readers.mjs']
    .map(path => [path, hash(readFileSync(new URL(path, root)))])),
  manifestSha256: hash(readFileSync(new URL('docs/fixtures/image-ocr/manifest.json', root))),
  limits: { documents: 27, concurrency: 1, maximumModelCalls: 108, maximumPrimaryAttempts: 3, maximumOcrAttempts: 1, harnessRetries: 0 },
  context: { financialEngineEvaluated: false, productionDatabaseWrites: false, labelsSentToReaders: false,
    gate: 'Actual shadow gate and hypothetical enabled gate are separate. Only server shadow warning is removed for the latter.',
    cost: 'Reported attempts only; excludes unreported/interrupted usage and any account-level charges.',
    newSet: 'Labels and hashes fixed before first evaluation; tuning makes subsequent runs regression.' }, results: [], summary: null };
const save = () => { const s = JSON.stringify(report, null, 2) + '\n'; assert.equal(s.includes(token), false); writeFileSync(output, s); };
const check = read => checkExtraction({ documentSha256: read.documentSha256, primaryReadId: read.primaryReadId,
  candidate: read.extraction, corroboration: read.corroboration });
save();
for (const scenario of scenarios) {
  const row = { caseId: scenario.id, set: scenario.set, file: scenario.file, sourcePath: scenario.path,
    variations: scenario.variations ?? [], expectedExtraction: scenario.expectedExtraction,
    expectedAction: scenario.expectedAction ?? scenario.expected?.action ?? null,
    mustRequireReadingReview: scenario.mustRequireReadingReview, error: null, read: null };
  const started = Date.now();
  try {
    const response = await fetch(report.target + '/api/internal/document-probe', { method: 'POST', signal: AbortSignal.timeout(65000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': scenario.file.mimeType }, body: readFileSync(new URL(scenario.path, root)) });
    const payload = await response.json(); row.httpStatus = response.status;
    if (!response.ok) row.error = payload.error;
    else {
      row.read = payload.data;
      assert.equal(row.read.documentSha256, scenario.file.sha256);
      assert.equal(row.read.provenance.imageOcr?.model, 'qwen/qwen3.8-flash');
      const ocr = row.read.provenance.imageOcr;
      assert.equal(ocr.documentSha256, scenario.file.sha256);
      assert.equal(row.read.corroboration.method, 'OCR');
      row.actualGate = check(row.read).status;
      row.enabledRead = { ...row.read, extraction: { ...row.read.extraction,
        extractionWarnings: row.read.extraction.extractionWarnings.filter(w => w !== 'INDEPENDENT_IMAGE_OCR_SHADOW') } };
      row.enabledGate = check(row.enabledRead).status;
      row.secondary = parsePdfText(ocr.text);
      row.primaryExactFields = fields.filter(f => row.read.extraction[f] === scenario.expectedExtraction[f]);
      row.secondaryExactFields = fields.filter(f => row.secondary.fields[f] === scenario.expectedExtraction[f]);
      row.falseCrossCheck = row.enabledGate === 'CROSS_CHECKED' && (scenario.mustRequireReadingReview || row.primaryExactFields.length !== 8 || row.secondaryExactFields.length !== 8);
      row.ocrCostUsd = ocr.usage.costUsd;
    }
  } catch (error) { row.error = { code: error.name === 'AssertionError' ? 'HARNESS_ASSERTION' : 'READ_FAILED' }; }
  row.durationMs = Date.now() - started;
  report.results.push(row); save();
  console.log(JSON.stringify({ completed: report.results.length, caseId: row.caseId, primaryExact: row.primaryExactFields?.length,
    secondaryExact: row.secondaryExactFields?.length, enabledGate: row.enabledGate, falseCrossCheck: row.falseCrossCheck, error: row.error?.code }));
}
const ok = report.results.filter(r => r.read && !r.error), times = ok.map(r => r.durationMs).sort((a,b)=>a-b);
report.finishedAt = new Date().toISOString();
report.summary = { attempted: scenarios.length, successfulReads: ok.length, failures: report.results.filter(r=>r.error).length,
  primaryAllEightExact: ok.filter(r=>r.primaryExactFields.length === 8).length,
  secondaryAllEightExact: ok.filter(r=>r.secondaryExactFields.length === 8).length,
  actualCrossChecked: ok.filter(r=>r.actualGate === 'CROSS_CHECKED').length,
  enabledCrossChecked: ok.filter(r=>r.enabledGate === 'CROSS_CHECKED').length,
  falseCrossChecks: ok.filter(r=>r.falseCrossCheck).length,
  ocrReportedCostUsd: ok.reduce((sum,r)=>sum+(r.ocrCostUsd ?? 0),0),
  primaryReportedCostUsd: ok.reduce((sum,r)=>sum+(r.read.provenance.usage?.costUsd ?? 0),0),
  medianReadDurationMs: times.length ? times[Math.floor(times.length/2)] : null,
  financialDecisions: 'NOT_EVALUATED', automaticApprovals: 'NOT_EVALUATED' };
save(); console.log(JSON.stringify({ output: output.pathname, summary: report.summary }, null, 2));
if (report.summary.failures || report.summary.falseCrossChecks) process.exitCode = 1;

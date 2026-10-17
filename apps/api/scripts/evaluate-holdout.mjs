import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const usage = 'Usage: node apps/api/scripts/evaluate-holdout.mjs --run\nRuns 8 private production document reads sequentially, at most 3 model attempts per document.\nReads .env.extraction-probe internally. No financial engine, D1 writes, uploads or payments.\nOptional EVALUATION_WORKER_VERSION records the deployed release identifier.\n';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(usage);
} else if (process.argv.length !== 3 || process.argv[2] !== '--run') {
  console.error('Explicit --run is required before accessing credentials, files or the network.\n' + usage);
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  const { ExtractedInvoiceSchema, checkExtraction } = await import('@oli/contracts');
  const root = new URL('../../../', import.meta.url);
  const fixtureRoot = new URL('docs/fixtures/invoice-holdout/', root);
  const manifestBytes = readFileSync(new URL('manifest.json', fixtureRoot));
  const manifest = JSON.parse(manifestBytes);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const fields = ['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'servicePeriod', 'description'];
  const critical = ['vendorName', 'amountMinor', 'currency', 'dueDate'];
  // Reader-only hazards differ from policy prohibitions: a correctly read high total may be CROSS_CHECKED.
  const readingReviewCases = new Set(['holdout_004', 'holdout_005', 'holdout_006', 'holdout_007']);
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.datasetVersion, 'oli-invoice-holdout-v1');
  assert.equal(manifest.cases.length, 8);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, 8);
  const documents = new Map();
  for (const scenario of manifest.cases) {
    assert.match(scenario.id, /^holdout_00[1-8]$/);
    assert.match(scenario.file.path, /^documents\/00[1-8]\.(pdf|png)$/);
    assert.ok(['application/pdf', 'image/png'].includes(scenario.file.mimeType));
    assert.deepEqual(Object.keys(scenario.expectedExtraction).sort(), [...fields].sort());
    const bytes = readFileSync(new URL(scenario.file.path, fixtureRoot));
    assert.equal(hash(bytes), scenario.file.sha256);
    assert.equal(bytes.byteLength, scenario.file.sizeBytes);
    assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 5 * 1024 * 1024);
    documents.set(scenario.id, bytes);
  }
  const token = readFileSync(new URL('.env.extraction-probe', root), 'utf8').trim();
  assert.ok(token.length >= 32 && token.length <= 512, 'Private probe token is missing or malformed');
  const target = 'https://oli-api.tiamat-agency.workers.dev';
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const output = new URL(`docs/evaluations/invoices-holdout-${runId}.json`, root);
  const codePaths = ['apps/api/scripts/evaluate-holdout.mjs', 'apps/api/worker/document.js',
    'apps/api/worker/extraction-probe.js', 'packages/extraction/src/openrouter.ts', 'packages/contracts/src/index.ts'];
  const report = {
    runId, startedAt: new Date().toISOString(), finishedAt: null,
    scope: 'PRODUCTION_DOCUMENT_READERS_AND_LOCAL_EXTRACTION_COMPARISON_ONLY',
    datasetVersion: manifest.datasetVersion, manifestSha256: hash(manifestBytes),
    target, remoteWorkerVersion: process.env.EVALUATION_WORKER_VERSION ?? null,
    localGitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    localCodeSha256: Object.fromEntries(codePaths.map(path => [path, hash(readFileSync(new URL(path, root)))])),
    limits: { documents: 8, concurrency: 1, maximumModelCalls: 24, modelCallsPerDocument: 3, harnessRetries: 0, requestTimeoutMs: 65000 },
    context: { productionDatabaseWrites: false, financialEngineEvaluated: false, financialContextSeeded: false,
      labelsSentToExtractor: false, automaticApprovalMetrics: 'NOT_EVALUATED',
      crossCheckedMeaning: 'Agreement of server-owned independent reads, not correctness, policy authorization or approval.',
      cost: 'Only usage costs explicitly reported by the reader/attempts; interrupted calls and conversion may be billed separately.',
      releaseIdentity: 'Local source hashes describe this comparison harness. Remote source identity is only the supplied deployment version plus returned reader provenance.',
      holdout: 'Separate from original 50. Once used to tune code or prompts, subsequent runs are regression measurements.' },
    results: [], summary: null,
  };
  const save = () => {
    const serialized = JSON.stringify(report, null, 2) + '\n';
    assert.equal(serialized.includes(token), false, 'Refusing to persist probe credentials');
    mkdirSync(new URL('docs/evaluations/', root), { recursive: true });
    const temporary = new URL(output.href + '.tmp');
    writeFileSync(temporary, serialized);
    renameSync(temporary, output);
  };
  const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'UNCLASSIFIED_ERROR';
  const safeFailure = error => ({ code: safeCode(error?.code ?? error?.message), type: error?.name === 'AssertionError' ? 'HARNESS_ASSERTION' : 'READ_FAILED' });
  const median = times => {
    const sorted = [...times].sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  save();
  for (const scenario of manifest.cases) {
    const row = { caseId: scenario.id, file: scenario.file, variations: scenario.variations,
      startedAt: new Date().toISOString(), durationMs: null, httpStatus: null, error: null,
      expectedExtraction: scenario.expectedExtraction, safetyExpected: scenario.safetyExpected,
      financialPolicySafety: 'NOT_EVALUATED', read: null, modelAttempts: [], extractionCheck: null,
      independentStatus: 'NOT_RETURNED', canEvaluateAutomatically: false, readerGateViolation: false };
    const started = Date.now();
    try {
      // The request contains document bytes and MIME only, never labels, seed, expected fields or policy.
      const response = await fetch(target + '/api/internal/document-probe', {
        method: 'POST', signal: AbortSignal.timeout(report.limits.requestTimeoutMs),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': scenario.file.mimeType },
        body: documents.get(scenario.id),
      });
      row.httpStatus = response.status;
      const payload = await response.json();
      if (!response.ok) {
        row.error = { code: safeCode(payload.error?.code), type: 'READER_HTTP_ERROR' };
        row.modelAttempts = Array.isArray(payload.error?.attempts) ? payload.error.attempts : [];
      } else {
        const read = payload.data;
        assert.equal(read?.documentSha256, scenario.file.sha256, 'SERVER_DOCUMENT_HASH_MISMATCH');
        const actual = ExtractedInvoiceSchema.parse(read.extraction);
        row.read = { ...read, extraction: actual };
        row.modelAttempts = read.provenance?.attempts ?? [];
        row.matchingFields = fields.filter(field => actual[field] === scenario.expectedExtraction[field]);
        row.mismatches = fields.filter(field => !row.matchingFields.includes(field))
          .map(field => ({ field, expected: scenario.expectedExtraction[field], actual: actual[field] }));
        row.allEightFieldsExact = row.matchingFields.length === fields.length;
        row.criticalFieldsExact = critical.every(field => row.matchingFields.includes(field));
        row.extractionCheck = checkExtraction({ documentSha256: scenario.file.sha256,
          primaryReadId: read.primaryReadId, candidate: actual, corroboration: read.corroboration });
        row.independentStatus = read.corroboration ? row.extractionCheck.status : 'UNAVAILABLE';
        row.canEvaluateAutomatically = row.extractionCheck.status === 'CROSS_CHECKED';
        row.readerGateMustRequireReview = readingReviewCases.has(scenario.id);
        row.readerGateViolation = row.canEvaluateAutomatically && row.readerGateMustRequireReview;
        row.readerGateOutcome = row.readerGateViolation ? 'FAIL' : 'PASS';
        row.warnings = actual.extractionWarnings;
      }
      assert.ok(Array.isArray(row.modelAttempts) && row.modelAttempts.length <= 3, 'MODEL_ATTEMPT_LIMIT_EXCEEDED');
    } catch (error) {
      row.error = safeFailure(error);
    }
    row.durationMs = Date.now() - started;
    report.results.push(row);
    save();
    console.log(JSON.stringify({ completed: report.results.length, total: manifest.cases.length,
      caseId: row.caseId, httpStatus: row.httpStatus, exactFields: row.matchingFields?.length ?? null,
      independentStatus: row.independentStatus, readerGateViolation: row.readerGateViolation,
      durationMs: row.durationMs, error: row.error?.code ?? null }));
  }
  const returned = report.results.filter(row => row.read && !row.error);
  const attempts = report.results.flatMap(row => row.modelAttempts);
  const costs = report.results.flatMap(row => row.modelAttempts.some(attempt => Number.isFinite(attempt.usage?.costUsd))
    ? row.modelAttempts.map(attempt => attempt.usage?.costUsd).filter(Number.isFinite)
    : Number.isFinite(row.read?.provenance?.usage?.costUsd) ? [row.read.provenance.usage.costUsd] : []);
  report.finishedAt = new Date().toISOString();
  report.summary = {
    attempted: report.results.length, returnedExtractions: returned.length,
    failures: report.results.filter(row => row.error).length,
    allEightFieldsExact: returned.filter(row => row.allEightFieldsExact).length,
    criticalFieldsExact: returned.filter(row => row.criticalFieldsExact).length,
    fieldMatches: Object.fromEntries(fields.map(field => [field, {
      exact: returned.filter(row => row.matchingFields.includes(field)).length,
      attempted: report.results.length, returned: returned.length,
    }])),
    independentCrossChecked: returned.filter(row => row.extractionCheck.status === 'CROSS_CHECKED').length,
    reviewRequired: returned.filter(row => row.extractionCheck.status === 'REVIEW_REQUIRED').length,
    withWarnings: returned.filter(row => row.warnings.length > 0).length,
    expectedReviewCases: [...readingReviewCases],
    expectedReviewCasesReturned: returned.filter(row => readingReviewCases.has(row.caseId)).length,
    readerGateViolations: report.results.filter(row => row.readerGateViolation).length,
    observedModelAttempts: attempts.length,
    modelAttemptCountsAvailableFor: report.results.filter(row => row.modelAttempts.length > 0).length,
    reportedPartialCostUsd: costs.reduce((total, cost) => total + cost, 0),
    reportedCostItems: costs.length,
    medianAttemptDurationMs: median(report.results.map(row => row.durationMs)),
    medianSuccessfulReadDurationMs: median(returned.map(row => row.durationMs)),
    maxDurationMs: Math.max(...report.results.map(row => row.durationMs)),
    automaticApprovals: 'NOT_EVALUATED', financialDecisions: 'NOT_EVALUATED',
  };
  assert.ok(attempts.length <= report.limits.maximumModelCalls, 'MODEL_ATTEMPT_LIMIT_EXCEEDED');
  save();
  console.log(JSON.stringify({ output: output.pathname, summary: report.summary }, null, 2));
  if (report.summary.failures || report.summary.readerGateViolations
    || report.summary.allEightFieldsExact !== manifest.cases.length) process.exitCode = 1;
}

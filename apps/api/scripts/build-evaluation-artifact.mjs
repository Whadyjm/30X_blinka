import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
assert.ok(process.argv.length === 3);
assert.match(source, /^docs\/evaluations\/candidate-(marena|selva|ronda)-live-[\dTZ-]+\.json$/);
const root = new URL('../../../', import.meta.url);
const bytes = readFileSync(new URL(source, root)), run = JSON.parse(bytes);
assert.ok(run.finishedAt && run.results.length === 20 && run.setup.sessionRevoked);
assert.ok(run.backendAtStart.backendExact && run.candidate.bundleSha256 === run.backendAtStart.bundleSha256);
const cases = run.results.map(row => {
  const actual = row.initialDecision?.action ?? null;
  if (row.detail?.latestDecision?.action === 'APPROVE' && !row.unsafeApproval) {
    assert.equal(row.policyEquivalentFields.length, 8);
    assert.equal(row.read.extraction.extractionWarnings.length, 0);
    assert.equal(row.after.invoiceReservations, 1);
  }
  return { id: row.caseId, expectedAction: row.expected.action, actualAction: actual,
    finalAction: row.detail?.latestDecision?.action ?? null, correct: row.correct === true,
    unsafeApproval: row.unsafeApproval === true,
    correctAutonomous: row.initialCorrect === true && ['APPROVE', 'BLOCK'].includes(actual),
    explained: !!(row.initialDecision?.humanExplanation && row.initialDecision.trace.length),
    technicalError: row.detail?.processingError?.code ?? null,
    readerModel: row.read?.provenance.model ?? null, durableJobAttempts: row.job?.attempts ?? null,
    readerFallbackUsed: (row.read?.provenance.attempts?.length ?? 0) > 1,
    requiredReasons: row.expected.requiredReasons, actualReasons: row.initialDecision?.reasons ?? [],
    literalExactFields: row.matchingFields?.length ?? 0, policyEquivalentFields: row.policyEquivalentFields?.length ?? 0 };
});
let concurrentAudit = null;
if (run.fatalError?.message.startsWith('Published backend changed during validation')) {
  const path = 'docs/evaluations/ronda-concurrent-deployment-audit-20261017.json';
  const auditBytes = readFileSync(new URL(path, root)), audit = JSON.parse(auditBytes);
  assert.equal(audit.sourceReportSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(audit.readerFinancialAndAuthCodeUnchanged && audit.allOtherBundleBytesIdentical && audit.addedRouteReadOnly);
  concurrentAudit = { path, sha256: createHash('sha256').update(auditBytes).digest('hex'),
    onlyAddedEndpoint: audit.onlyAddedEndpoint, readerFinancialAndAuthCodeUnchanged: true,
    versions: [audit.previousVersion, audit.currentVersion] };
}
const evidence = {
  displayName: `${run.company.slug} ficticia · lectores y cola reales · ${run.backendAtStart.version.slice(0, 8)} histórico`,
  datasetVersion: JSON.parse(readFileSync(new URL(run.manifestPath, root))).datasetVersion,
  evaluatedAt: run.finishedAt, workerVersion: run.backendAtStart.version, bundleSha256: run.candidate.bundleSha256,
  reportPath: source, reportSha256: createHash('sha256').update(bytes).digest('hex'), manifestSha256: run.manifestSha256,
  scope: run.scope, synthetic: true, targetedP0IncludedInDenominator: false,
  limits: 'One predeclared synthetic company using supported labelled PDF/PNG/JPEG layouts. Failed reads are included. Historical measurement, not a guarantee for all invoices.',
  readerVersion: run.results.find(row => row.read)?.read.provenance.configVersion,
  validation: { runnerGuard: run.fatalError ?? null, independentlyReviewedConcurrentRelease: concurrentAudit },
  cases,
};
writeFileSync(new URL('../worker/evaluation-data.js', import.meta.url),
  '// Generated from the immutable run identified below; never edit measured counters.\nexport default ' + JSON.stringify(evidence, null, 2) + ';\n');
console.log(JSON.stringify({ source, cases: cases.length, sha256: evidence.reportSha256 }));

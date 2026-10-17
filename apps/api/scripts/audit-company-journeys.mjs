import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const paths = process.argv.slice(2);
assert.equal(paths.length, 3, 'Pass the three completed live company-journey report paths');
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = paths.map(path => {
  assert.match(path, /^docs\/evaluations\/company-journey-(lumen|brisa|cedro)-\d[^/]+\.json$/);
  const bytes = readFileSync(path);
  const report = JSON.parse(bytes);
  assert.equal(report.scope, 'REAL_REMOTE_READERS_LOCAL_API_QUEUE_CONSUMER_D1_R2_CUMULATIVE_COMPANY');
  assert.equal(report.results.length, 20);
  assert.ok(report.finishedAt && report.summary && report.sourceUnchanged && report.manifestUnchanged);
  return { path, sha256: hash(bytes), report };
});
assert.equal(new Set(sources.map(s => s.report.company.slug)).size, 3);

function auditApproval(row, rules) {
  const reasons = [...(row.unsafeApprovalReasons ?? [])];
  const decision = row.detail?.latestDecision;
  if (decision?.action !== 'APPROVE') return reasons;
  if (row.expectedFinalAction !== 'APPROVE') {
    // A different actual ledger can explain budget-only outcomes, never duplicate or identity prohibitions.
    const budgetOnly = row.expected.requiredReasons.length > 0
      && row.expected.requiredReasons.every(reason => reason === 'BUDGET_EXCEEDED');
    const actualBudgetSufficient = decision.facts.amountMinor <= rules.monthlyBudgetMinor - row.before.reservedMinor;
    if (!(row.referenceContextDiverged && budgetOnly && actualBudgetSufficient)) reasons.push('REFERENCE_FORBIDS_APPROVAL');
  }
  return [...new Set(reasons)];
}

const companies = sources.map(({ path, sha256, report }) => {
  const rows = report.results.map(row => ({
    caseId: row.caseId, invoiceId: row.invoiceId, expectedFinalAction: row.expectedFinalAction,
    initialAction: row.initialDecision?.action ?? null, finalAction: row.detail?.latestDecision?.action ?? null,
    matchesFullScript: !!row.correct, referenceContextDiverged: !!row.referenceContextDiverged,
    unsafeApprovalReasons: auditApproval(row, report.setup.activatedPolicy.rules),
    reservationCount: row.after?.invoiceReservations ?? null,
  }));
  return { company: report.company, source: path, sourceSha256: sha256,
    summary: { ...report.summary, rawHarnessUnsafeApprovals: report.summary.unsafeApprovals,
      unsafeApprovals: rows.filter(r => r.unsafeApprovalReasons.length).length },
    finalLedger: report.finalLedger, rows };
});

// Regression evidence: an unresolved earlier invoice must not excuse the measured duplicate's approval.
const brisa = sources.find(s => s.report.company.slug === 'brisa').report;
const duplicate = brisa.results.find(r => r.caseId === '012');
const original = brisa.results.find(r => r.caseId === '001');
assert.equal(duplicate.detail.latestDecision.action, 'APPROVE');
assert.equal(original.detail.vendorId, null);
assert.equal(duplicate.read.extraction.vendorName, original.read.extraction.vendorName);
assert.equal(duplicate.read.extraction.invoiceNumber, original.read.extraction.invoiceNumber);
assert.equal(duplicate.after.invoiceReservations, 1);
assert.ok(auditApproval(duplicate, brisa.setup.activatedPolicy.rules).includes('REFERENCE_FORBIDS_APPROVAL'));
const budgetOnly = structuredClone(duplicate);
budgetOnly.expected = { ...budgetOnly.expected, requiredReasons: ['BUDGET_EXCEEDED'] };
assert.deepEqual(auditApproval(budgetOnly, brisa.setup.activatedPolicy.rules), []);

const totals = {};
for (const key of ['attempted', 'decided', 'fullyCorrect', 'unsafeApprovals', 'unexpectedApprovals', 'readerFailures',
  'harnessErrors', 'allEightFieldsExact', 'correctAutonomous', 'explainedDecisions', 'approved', 'blocked', 'escalated',
  'explicitHumanReviews', 'uploadReplays', 'processingReplays', 'privateDocumentsVerified', 'remoteProbeCalls', 'readerCacheHits',
  'successfulPrimaryReportedCostUsd', 'successfulSecondaryReportedCostUsd']) {
  totals[key] = companies.reduce((n, c) => n + c.summary[key], 0);
}
const audit = { auditedAt: new Date().toISOString(), scope: 'OFFLINE_SAFETY_AUDIT_OF_THREE_PRESERVED_REAL_JOURNEYS',
  modelCalls: 0, productionWrites: 0,
  correction: { reason: 'The raw runner exempted every unexpected approval when cumulative budget diverged. That exemption must apply only to a budget-only expected prohibition.',
    affectedCase: 'brisa/012', rawUnsafeApprovals: companies.reduce((n, c) => n + c.summary.rawHarnessUnsafeApprovals, 0),
    auditedUnsafeApprovals: totals.unsafeApprovals,
    financialCause: 'Earlier invoice 001 has correct primary supplier/number but failed corroboration and stored vendor_id=null. Duplicate-number checks require the same resolved vendor ID, allowing invoice 012 with that supplier/number and different bytes to APPROVE.',
    productFixed: false, runnerClassificationFixedForFutureRuns: true,
    originalReportsPreserved: true },
  totals, companies,
  limits: ['Programmatic local API, D1/R2 and original consumer with controlled queue transport; no browser or remote financial writes.',
    'Primary and secondary readers are real remote services; their exact remote Worker deployment ID was not independently verified.',
    'fullyCorrect measures agreement with the predeclared cumulative script. Earlier abstentions change subsequent actual budgets; budget mismatches alone are not proof of unsafe policy decisions.',
    'Documents use the supported explicit label vocabulary; Lumen also has conflicting header brands, retained as a dataset limitation.',
    'Reported successful response costs may exclude failed calls and conversion.'] };
const output = 'docs/evaluations/company-journeys-audit-20261017.json';
writeFileSync(output, JSON.stringify(audit, null, 2) + '\n');
for (const source of sources) assert.equal(hash(readFileSync(source.path)), source.sha256, 'Raw report changed during audit');
assert.equal(totals.attempted, 60);
assert.equal(totals.unsafeApprovals, 1);
console.log(JSON.stringify({ output, totals }, null, 2));

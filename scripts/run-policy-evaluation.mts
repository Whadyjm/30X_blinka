import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { EvaluationSummarySchema } from '../packages/contracts/src/index.ts';
import type {
  Agreement, BudgetPeriod, DecisionAction, DecisionReasonCode, ExtractedInvoice,
  MandateRules, PolicyVersion, Vendor,
} from '../packages/contracts/src/index.ts';
import { evaluateInvoice } from '../packages/domain/src/index.ts';
import type { PolicyInvoice, PolicyContext } from '../packages/domain/src/index.ts';

const root = new URL('../', import.meta.url);

type CorpusCase = {
  id: string;
  file: { sha256: string };
  expectedExtraction: ExtractedInvoice;
  document: { agreementReference: string };
  context: {
    budget: BudgetPeriod | null;
    policyRulesOverride: Partial<MandateRules>;
    priorInvoices: Array<{ invoiceId: string; sha256: string; vendorId: string | null; extraction: ExtractedInvoice }>;
  };
  expected: { action: DecisionAction; needsHumanApproval: boolean; requiredReasons: DecisionReasonCode[] };
};

export function evaluatePolicyCorpus() {
  const corpus: { datasetVersion: string; evaluationTime: string; cases: CorpusCase[] } = JSON.parse(readFileSync(new URL('fixtures/scenarios/invoices.json', root), 'utf8'));
  const seed: { organization: { id: string }; policy: PolicyVersion; vendors: Vendor[]; agreements: Agreement[] } = JSON.parse(readFileSync(new URL('fixtures/seed/company.json', root), 'utf8'));
  const cases = corpus.cases.map((item) => {
    // These are labelled parser fixtures, not outputs measured from an OCR/model run.
    const ex = item.expectedExtraction;
    const invoice: PolicyInvoice = {
      id: `inv_${item.id}`, documentSha256: item.file.sha256, primaryReadId: `fixture_visual_${item.id}`,
      extraction: ex, agreementReference: item.document.agreementReference,
      corroboration: { documentSha256: item.file.sha256, readId: `fixture_text_${item.id}`, method: 'PDF_TEXT',
        fields: { vendorName: ex.vendorName, amountMinor: ex.amountMinor, currency: ex.currency, dueDate: ex.dueDate } },
    };
    const context: PolicyContext = {
      organizationId: seed.organization.id, decisionId: `dec_${item.id}`, checkedAt: corpus.evaluationTime,
      budgetPeriodKey: item.context.budget?.periodKey ?? corpus.evaluationTime.slice(0, 7),
      policy: { ...seed.policy, rules: { ...seed.policy.rules, ...item.context.policyRulesOverride } },
      vendors: seed.vendors, agreements: seed.agreements, budget: item.context.budget,
      priorInvoices: item.context.priorInvoices.map((prior) => ({
        id: prior.invoiceId, documentSha256: prior.sha256, vendorId: prior.vendorId,
        agreementId: null, extraction: prior.extraction, reservationActive: false,
      })),
    };
    const actual = evaluateInvoice(invoice, context);
    const decision = actual.candidate;
    const correct = decision.action === item.expected.action
      && decision.needsHumanApproval === item.expected.needsHumanApproval
      && item.expected.requiredReasons.every((reason) => decision.reasons.includes(reason));
    return { id: item.id, expected: item.expected, actual, correct };
  });
  const total = cases.length;
  const correct = cases.filter((item) => item.correct).length;
  const autonomous = cases.filter((item) => item.correct && item.actual.candidate.action !== 'ESCALATE').length;
  const explained = cases.filter((item) => item.actual.candidate.humanExplanation.length > 0 && item.actual.candidate.trace.length > 0).length;
  const unsafe = cases.filter((item) => item.actual.candidate.action === 'APPROVE' && item.expected.action !== 'APPROVE').length;
  const summary = EvaluationSummarySchema.parse({
    datasetVersion: corpus.datasetVersion, evaluatedAt: new Date().toISOString(), totalCases: total,
    correctDecisions: correct, unsafeApprovals: unsafe, correctAutonomousCases: autonomous,
    explainedDecisions: explained, decisionAccuracy: correct / total,
    correctAutonomy: autonomous / total, explanationCoverage: explained / total,
  });
  return { scope: 'POLICY_ENGINE_ONLY', syntheticCorroboration: true,
    note: 'Prueba del motor con campos normalizados y corroboración sintética. No mide OCR, D1 ni pagos.', summary, cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = evaluatePolicyCorpus();
  const output = new URL('docs/evaluations/policy-engine-v1.json', root);
  mkdirSync(new URL('.', output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ scope: report.scope, ...report.summary }, null, 2));
  if (report.summary.correctDecisions !== report.summary.totalCases || report.summary.unsafeApprovals !== 0) process.exitCode = 1;
}

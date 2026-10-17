import { EvaluationSummarySchema } from '@oli/contracts';
import evidence from './evaluation-data.js';

// This is one immutable, fictitious evaluation; it is never computed from a customer's invoices.
export function evaluationSummary() {
  const total = evidence.cases.length;
  const correct = evidence.cases.filter(row => row.correct).length;
  const autonomous = evidence.cases.filter(row => row.correctAutonomous).length;
  const explained = evidence.cases.filter(row => row.explained).length;
  return EvaluationSummarySchema.parse({ datasetVersion: evidence.displayName, evaluatedAt: evidence.evaluatedAt,
    totalCases: total, correctDecisions: correct, unsafeApprovals: evidence.cases.filter(row => row.unsafeApproval).length,
    correctAutonomousCases: autonomous, explainedDecisions: explained, decisionAccuracy: correct / total,
    correctAutonomy: autonomous / total, explanationCoverage: explained / total });
}

export function evaluationReport() {
  return { ...evidence, summary: evaluationSummary() };
}

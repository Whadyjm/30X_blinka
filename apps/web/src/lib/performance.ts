import type { EvaluationSummary } from '@/contracts';

/** Accuracy belongs to the labelled run, never inferred from company approvals. */
export function performanceRating(summary: Pick<EvaluationSummary, 'totalCases' | 'decisionAccuracy' | 'unsafeApprovals'> | null | undefined) {
  if (!summary || summary.totalCases === 0) return null;
  const score = Math.round(summary.decisionAccuracy * 1000) / 10;
  const status = summary.unsafeApprovals > 0 || summary.decisionAccuracy < 0.8 ? 'Needs improvement'
    : summary.decisionAccuracy >= 0.95 ? 'Doing well' : 'Needs attention';
  return { score, status, safe: summary.unsafeApprovals === 0 };
}

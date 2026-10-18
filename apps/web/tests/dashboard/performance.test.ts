import { describe, expect, it } from 'vitest';
import { performanceRating } from '../../src/lib/performance';

describe('performance rating from labelled evidence', () => {
  it('does not invent a score without measured cases', () => {
    expect(performanceRating(null)).toBeNull();
    expect(performanceRating({ totalCases: 0, decisionAccuracy: 1, unsafeApprovals: 0 })).toBeNull();
  });
  it.each([[1, 'Doing well'], [0.95, 'Doing well'], [0.949, 'Needs attention'], [0.8, 'Needs attention'], [0.799, 'Needs improvement']])('rates %s using unrounded thresholds', (accuracy, status) => {
    expect(performanceRating({ totalCases: 20, decisionAccuracy: Number(accuracy), unsafeApprovals: 0 })?.status).toBe(status);
  });
  it('flags any unsafe approval even when the average is high', () => {
    expect(performanceRating({ totalCases: 100, decisionAccuracy: 0.99, unsafeApprovals: 1 })).toEqual({ score: 99, status: 'Needs improvement', safe: false });
  });
});

import { expect, it } from 'vitest';
import { buildTrace } from '../../src/lib/trace';
import { PolicyDecisionSchema } from '../../src/contracts';

it.each(['BUDGET', 'BUDGET_EXCEEDED', 'AMOUNT_LIMIT', 'AUTO_LIMIT', 'HARD_LIMIT'])('preserves the server explanation and evidence for %s', rule => {
  const observed = 'No existe presupuesto compatible para la moneda y periodo de evaluación.';
  const original = { rule, result: 'FAIL' as const, observed, evidence: '{"invoiceCurrency":"USD","periodKey":"2026-10"}' };
  const result = buildTrace(PolicyDecisionSchema.parse({ decision: 'BLOCK', facts: { amountMinor: 20000, currency: 'USD' }, reasons: ['MISSING_BUDGET'], trace: [original] }));
  expect(result[0]!.observed).toBe(observed); expect(result[0]!.evidence).toBe(original.evidence);
  expect(original).toEqual({ rule, result: 'FAIL', observed, evidence: '{"invoiceCurrency":"USD","periodKey":"2026-10"}' });
});

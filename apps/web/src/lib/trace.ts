import type { PolicyDecision, TraceStep } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatMoney } from './money';

/**
 * Decision Trace for the UI.
 * Prefers the server-provided `trace`; otherwise derives one from `reasons` + `facts`
 * (both are real, persisted data — nothing here is invented). §9.5.
 */
export function buildTrace(d: PolicyDecision): TraceStep[] {
  if (d.trace && d.trace.length > 0) return d.trace;

  const f = d.facts;
  const cur = f.currency;
  const version = typeof d.policyVersion === 'number' ? d.policyVersion : Number(d.policyVersion) || undefined;
  const money = (v: number | undefined) => (v == null ? undefined : formatMoney(v, cur));

  return d.reasons.map((code): TraceStep => {
    const info = reasonInfo(code);
    const result: TraceStep['result'] =
      info.tone === 'ok' ? 'PASS' : info.tone === 'block' ? 'FAIL' : info.tone === 'warn' ? 'WARN' : 'INFO';
    const step: TraceStep = {
      rule: code,
      result,
      policyVersion: version,
      checkedAt: d.checkedAt,
    };
    switch (code) {
      case 'AMOUNT_ABOVE_AUTO_LIMIT':
        step.field = t('amount');
        step.observed = money(f.amountMinor);
        step.expected = f.autoLimitMinor != null ? `≤ ${money(f.autoLimitMinor)}` : undefined;
        break;
      case 'AMOUNT_ABOVE_HARD_LIMIT':
        step.field = t('amount');
        step.observed = money(f.amountMinor);
        step.expected = f.hardLimitMinor != null ? `≤ ${money(f.hardLimitMinor)}` : undefined;
        break;
      case 'AGREEMENT_MISMATCH':
        step.field = t('amount vs agreement');
        step.observed = money(f.amountMinor);
        step.expected = f.agreementAmountMinor != null ? `≈ ${money(f.agreementAmountMinor)}` : undefined;
        break;
      case 'BUDGET_EXCEEDED':
        step.field = t('budget remaining');
        step.observed = money(f.amountMinor);
        step.expected = f.budgetRemainingMinor != null ? t('≤ {amount} left', { amount: money(f.budgetRemainingMinor) ?? '' }) : undefined;
        break;
      case 'ALLOWED_VENDOR':
      case 'UNKNOWN_VENDOR':
        step.field = t('vendor');
        step.observed = f.vendorAllowed == null ? undefined : f.vendorAllowed ? t('authorized') : t('not authorized');
        step.expected = t('authorized');
        break;
      case 'DUPLICATE_INVOICE':
      case 'POSSIBLE_DUPLICATE':
        step.field = t('invoice identity');
        step.observed = f.duplicateOfInvoiceId ? t('matches {id}', { id: f.duplicateOfInvoiceId }) : undefined;
        step.expected = t('unique');
        break;
      default:
        break;
    }
    return step;
  });
}

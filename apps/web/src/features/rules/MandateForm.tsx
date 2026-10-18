import { Info, Lock } from 'lucide-react';
import { MoneyField, Toggle } from '@/components/ui/Field';
import type { MandateDraftInput } from '@/contracts';
import { HARD_STOP_REASONS, reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/money';

export type MandateErrors = Partial<Record<'automaticLimitMinor' | 'hardLimitMinor' | 'monthlyBudgetMinor' | 'reviewAboveMinor', string>>;

export function emptyMandate(currency: string): MandateDraftInput {
  return {
    currency,
    automaticLimitMinor: 30_000,
    hardLimitMinor: 100_000,
    monthlyBudgetMinor: 200_000,
    requireAllowedVendor: true,
    requireAgreement: true,
    humanApprovalEnabled: true,
    reviewAboveMinor: 30_000,
    processDaysBeforeDue: 0,
    humanApprovableReasons: ['AMOUNT_ABOVE_AUTO_LIMIT', 'HUMAN_APPROVAL_REQUIRED'],
  };
}

export function validateMandate(v: MandateDraftInput): MandateErrors {
  const e: MandateErrors = {};
  if (!(v.automaticLimitMinor >= 0)) e.automaticLimitMinor = t('Enter zero or a positive amount.');
  if (!(v.hardLimitMinor >= 0)) e.hardLimitMinor = t('Enter zero or a positive amount.');
  else if (v.hardLimitMinor < v.automaticLimitMinor) e.hardLimitMinor = t('The absolute limit must be at least the automatic limit.');
  if (!(v.monthlyBudgetMinor >= 0)) e.monthlyBudgetMinor = t('Enter zero or a positive amount.');
  if (v.reviewAboveMinor < 0 || v.reviewAboveMinor > v.automaticLimitMinor) e.reviewAboveMinor = t('The review threshold must be between zero and the automatic limit.');
  return e;
}

export const hasErrors = (e: MandateErrors) => Object.keys(e).length > 0;

/** Controlled editor for the finance mandate (§4.2 step 2). Fields are in minor units. */
export function MandateForm({ value, onChange, disabled, showErrors, section }: { value: MandateDraftInput; onChange: (v: MandateDraftInput) => void; disabled?: boolean; showErrors?: boolean; section?: 'approval' | 'budget' | 'checks' }) {
  const errors = showErrors ? validateMandate(value) : {};
  const set = (p: Partial<MandateDraftInput>) => onChange({ ...value, ...p });
  const cur = value.currency;
  const hardStops = (
    <div className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
      <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
      <p>
        <span className="text-ink">{t('Never overridable by a “yes”:')}</span>{' '}
        {HARD_STOP_REASONS.map((c) => reasonInfo(c).label.toLowerCase()).join(', ')}.
      </p>
    </div>
  );

  return (
    <div className={section ? 'space-y-5' : 'space-y-8'}>
      {section !== 'checks' && <fieldset key={section ?? 'all'} className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-3 text-sm font-semibold text-slate-900">{t('Limits')}</legend>
        {(!section || section === 'approval') && <MoneyField label={t('Automatic approval limit')} currency={cur} valueMinor={value.automaticLimitMinor} onChange={(m) => set({ automaticLimitMinor: m ?? 0, reviewAboveMinor: Math.min(value.reviewAboveMinor, m ?? 0) })} error={errors.automaticLimitMinor} hint={t('Oli approves on its own up to this amount per invoice (if every other rule passes).')} />}
        {(!section || section === 'budget') && <MoneyField label={t('Absolute ceiling')} currency={cur} valueMinor={value.hardLimitMinor} onChange={(m) => set({ hardLimitMinor: m ?? 0 })} error={errors.hardLimitMinor} hint={t('Anything above this is blocked. A human can’t override it.')} />}
        {(!section || section === 'budget') && <MoneyField label={t('Monthly budget')} currency={cur} valueMinor={value.monthlyBudgetMinor} onChange={(m) => set({ monthlyBudgetMinor: m ?? 0 })} error={errors.monthlyBudgetMinor} hint={t('Total for the month in {currency}. Each approval reserves part of it. If the remaining budget cannot cover an invoice, it is blocked.', { currency: cur })} />}
        {(!section || section === 'approval') && <MoneyField label={t('Human review above')} currency={cur} valueMinor={value.reviewAboveMinor} onChange={(m) => set({ reviewAboveMinor: m ?? 0 })} error={errors.reviewAboveMinor} hint={t('Amounts above this threshold need a person, even below the automatic limit.')} />}
      </fieldset>}

      {section === 'approval' && <p className="text-sm leading-relaxed text-ink" aria-live="polite">{t('With these amounts, automatic approval is possible up to {amount}, only if every other rule passes. Above either threshold, human approval must be enabled.', { amount: formatMoney(Math.min(value.automaticLimitMinor, value.reviewAboveMinor), cur) })}</p>}

      {(!section || section === 'checks') && <fieldset className="space-y-4" disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold text-slate-900">{t('Who and what can be paid')}</legend>
        <Toggle label={t('Only authorized vendors')} description={t(value.requireAllowedVendor ? 'On: an unregistered vendor blocks the invoice. Add and authorize the vendor before trying it.' : 'Off: an unregistered vendor is allowed, but all other rules still apply. Explicitly unauthorized vendors remain blocked.')} checked={value.requireAllowedVendor} onChange={(v) => set({ requireAllowedVendor: v })} />
        <Toggle label={t('Require an agreement')} description={t(value.requireAgreement ? 'On: a missing agreement or a mismatch needs review. It is not an amount exception you can simply approve.' : 'Off: an invoice can proceed without an agreement. If an agreement is matched or referenced, it is still checked.')} checked={value.requireAgreement} onChange={(v) => set({ requireAgreement: v })} />
      </fieldset>}

      {(!section || section === 'checks') && <fieldset className="space-y-4" disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold text-slate-900">{t('When Oli should ask a person')}</legend>
        <Toggle
          label={t('Allow human approval of exceptions')}
          description={t(value.humanApprovalEnabled ? 'On: amounts above the review threshold can request approval. The ceiling, available budget and all mandatory checks must still pass.' : 'Off: an amount that requires human approval is blocked. Oli cannot approve it on its own.')}
          checked={value.humanApprovalEnabled}
          onChange={(v) => set({ humanApprovalEnabled: v })}
        />
        {value.humanApprovalEnabled && !section && <p className="text-sm text-slate-600">{t('Only amount exceptions within the ceiling and available budget can be authorized. Agreement discrepancies require correction.')}</p>}
        {section ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('Human review never bypasses your ceiling, budget or mandatory checks. Agreement discrepancies need correction.')}</p>
            <details>
              <summary className="cursor-pointer py-2 text-ink underline underline-offset-4">{t('See the checks that cannot be overridden')}</summary>
              {hardStops}
            </details>
          </div>
        ) : (
          hardStops
        )}
      </fieldset>}

      {(!section || section === 'budget') && showErrors && value.monthlyBudgetMinor > 0 && value.monthlyBudgetMinor < value.hardLimitMinor && (
        <p className="flex gap-2 text-sm text-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('Your monthly budget is lower than the absolute ceiling, so a single large invoice could be blocked for lack of budget.')}
        </p>
      )}
    </div>
  );
}

import { Info, Lock } from 'lucide-react';
import { Checkbox, MoneyField, TextField, Toggle } from '@/components/ui/Field';
import type { MandateDraftInput } from '@/contracts';
import { HARD_STOP_REASONS, OVERRIDABLE_REASONS, reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/money';

export type MandateErrors = Partial<Record<'automaticLimitMinor' | 'hardLimitMinor' | 'monthlyBudgetMinor' | 'processDaysBeforeDue', string>>;

export function emptyMandate(currency: string): MandateDraftInput {
  return {
    currency,
    automaticLimitMinor: 50_000,
    hardLimitMinor: 100_000,
    monthlyBudgetMinor: 500_000,
    requireAllowedVendor: true,
    requireAgreement: true,
    humanApprovalEnabled: true,
    reviewAboveMinor: 50_000,
    processDaysBeforeDue: 5,
    humanApprovableReasons: ['AMOUNT_ABOVE_AUTO_LIMIT', 'AGREEMENT_MISMATCH'],
  };
}

export function validateMandate(v: MandateDraftInput): MandateErrors {
  const e: MandateErrors = {};
  if (!(v.automaticLimitMinor > 0)) e.automaticLimitMinor = t('Enter an amount greater than zero.');
  if (!(v.hardLimitMinor > 0)) e.hardLimitMinor = t('Enter an amount greater than zero.');
  else if (v.hardLimitMinor < v.automaticLimitMinor) e.hardLimitMinor = t('The absolute limit must be at least the automatic limit.');
  if (!(v.monthlyBudgetMinor > 0)) e.monthlyBudgetMinor = t('Enter an amount greater than zero.');
  if (!Number.isInteger(v.processDaysBeforeDue) || v.processDaysBeforeDue < 0 || v.processDaysBeforeDue > 60) e.processDaysBeforeDue = t('Use a whole number from 0 to 60.');
  return e;
}

export const hasErrors = (e: MandateErrors) => Object.keys(e).length > 0;

/** Controlled editor for the finance mandate (§4.2 step 2). Fields are in minor units. */
export function MandateForm({ value, onChange, disabled, showErrors }: { value: MandateDraftInput; onChange: (v: MandateDraftInput) => void; disabled?: boolean; showErrors?: boolean }) {
  const errors = showErrors ? validateMandate(value) : {};
  const set = (p: Partial<MandateDraftInput>) => onChange({ ...value, ...p });
  const cur = value.currency;
  const approvable = new Set(value.humanApprovableReasons ?? []);
  const toggleReason = (code: string, on: boolean) => {
    const next = new Set(approvable);
    if (on) next.add(code);
    else next.delete(code);
    set({ humanApprovableReasons: [...next] });
  };

  return (
    <div className="space-y-8">
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-3 text-sm font-semibold text-slate-900">{t('Limits')}</legend>
        <MoneyField label={t('Automatic approval limit')} currency={cur} valueMinor={value.automaticLimitMinor} onChange={(m) => set({ automaticLimitMinor: m ?? 0, reviewAboveMinor: m ?? 0 })} error={errors.automaticLimitMinor} hint={t('Oli approves on its own up to this amount per invoice (if every other rule passes).')} />
        <MoneyField label={t('Absolute ceiling')} currency={cur} valueMinor={value.hardLimitMinor} onChange={(m) => set({ hardLimitMinor: m ?? 0 })} error={errors.hardLimitMinor} hint={t('Anything above this is blocked. A human can’t override it.')} />
        <MoneyField label={t('Monthly budget')} currency={cur} valueMinor={value.monthlyBudgetMinor} onChange={(m) => set({ monthlyBudgetMinor: m ?? 0 })} error={errors.monthlyBudgetMinor} hint={t('One budget per currency ({currency}). Approvals reserve from it.', { currency: cur })} />
        <TextField label={t('Process days before due date')} type="number" inputMode="numeric" min={0} max={60} value={String(value.processDaysBeforeDue)} onChange={(e) => set({ processDaysBeforeDue: e.target.value === '' ? -1 : Number(e.target.value) })} error={errors.processDaysBeforeDue} hint={t('How early Oli reviews an invoice before it’s due.')} />
      </fieldset>

      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold text-slate-900">{t('Who and what can be paid')}</legend>
        <Toggle label={t('Only authorized vendors')} description={t('Unknown vendors are blocked.')} checked={value.requireAllowedVendor} onChange={(v) => set({ requireAllowedVendor: v })} />
        <Toggle label={t('Require an agreement')} description={t('The invoice must match an active agreement (amount, currency, frequency).')} checked={value.requireAgreement} onChange={(v) => set({ requireAgreement: v })} />
      </fieldset>

      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold text-slate-900">{t('When Oli should ask a person')}</legend>
        <Toggle
          label={t('Allow human approval of exceptions')}
          description={t('Between {from} and {to}, an owner or approver can decide.', { from: formatMoney(value.automaticLimitMinor, cur), to: formatMoney(value.hardLimitMinor, cur) })}
          checked={value.humanApprovalEnabled}
          onChange={(v) => set({ humanApprovalEnabled: v })}
        />
        {value.humanApprovalEnabled && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-4">
            <p className="text-sm text-slate-700">{t('A person may approve invoices that only fail these checks:')}</p>
            {OVERRIDABLE_REASONS.map((code) => (
              <Checkbox key={code} label={reasonInfo(code).label} description={reasonInfo(code).rule} checked={approvable.has(code)} onChange={(on) => toggleReason(code, on)} />
            ))}
          </div>
        )}
        <div className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <p>
            <span className="text-ink">{t('Never overridable by a “yes”:')}</span>{' '}
            {HARD_STOP_REASONS.map((c) => reasonInfo(c).label.toLowerCase()).join(', ')}.
          </p>
        </div>
      </fieldset>

      {showErrors && value.monthlyBudgetMinor > 0 && value.monthlyBudgetMinor < value.hardLimitMinor && (
        <p className="flex gap-2 text-sm text-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('Your monthly budget is lower than the absolute ceiling, so a single large invoice could be blocked for lack of budget.')}
        </p>
      )}
    </div>
  );
}

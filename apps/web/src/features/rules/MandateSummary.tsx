import type { FinanceMandate, MandateDraftInput } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/money';

// `label` is the English i18n key; translated at render time. `show()` also runs at render time.
type Row = { key: keyof MandateDraftInput; label: string; show: (m: MandateDraftInput) => string };

const yn = (b: boolean) => (b ? t('Yes') : t('No'));

export const MANDATE_ROWS: Row[] = [
  { key: 'automaticLimitMinor', label: 'Automatic approval limit', show: (m) => formatMoney(m.automaticLimitMinor, m.currency) },
  { key: 'hardLimitMinor', label: 'Absolute ceiling', show: (m) => formatMoney(m.hardLimitMinor, m.currency) },
  { key: 'monthlyBudgetMinor', label: 'Monthly budget', show: (m) => formatMoney(m.monthlyBudgetMinor, m.currency) },
  { key: 'requireAllowedVendor', label: 'Only authorized vendors', show: (m) => yn(m.requireAllowedVendor) },
  { key: 'requireAgreement', label: 'Require an agreement', show: (m) => yn(m.requireAgreement) },
  { key: 'humanApprovalEnabled', label: 'Human approval of exceptions', show: (m) => yn(m.humanApprovalEnabled) },
  {
    key: 'humanApprovableReasons',
    label: 'A person may approve',
    show: (m) => (m.humanApprovalEnabled && m.humanApprovableReasons?.length ? m.humanApprovableReasons.map((c) => reasonInfo(c).label).join(', ') : '—'),
  },
  { key: 'processDaysBeforeDue', label: 'Process before due date', show: (m) => t('{n} days', { n: m.processDaysBeforeDue }) },
];

export function MandateSummary({ mandate, compareTo }: { mandate: MandateDraftInput | FinanceMandate; compareTo?: MandateDraftInput | FinanceMandate | null }) {
  return (
    <dl className="divide-y divide-hairline rounded-lg ring-1 ring-hairline">
      {MANDATE_ROWS.map((r) => {
        const now = r.show(mandate);
        const before = compareTo ? r.show(compareTo) : null;
        const changed = before != null && before !== now;
        return (
          <div key={r.key} className={`flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm ${changed ? 'bg-highlighter/30' : ''}`}>
            <dt className="text-slate-600">{t(r.label)}</dt>
            <dd className="text-right text-ink">
              {changed && <span className="mr-2 text-slate-400 line-through">{before}</span>}
              {now}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Which user-visible rows differ between two mandates. */
export function changedRows(a: MandateDraftInput | FinanceMandate, b: MandateDraftInput | FinanceMandate): string[] {
  return MANDATE_ROWS.filter((r) => r.show(a) !== r.show(b)).map((r) => t(r.label));
}

export function toDraftInput(m: FinanceMandate): MandateDraftInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { version: _v, id: _i, status: _s, createdAt: _c, createdByName: _n, ...rest } = m;
  return rest;
}

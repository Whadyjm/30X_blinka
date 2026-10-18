import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { OutcomeBadge, SourceBadge } from '@/components/Badges';
import type { InvoiceSummary } from '@/contracts';
import { t } from '@/i18n';
import { dueLabel, timeAgo } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getOutcome, processingLabel } from '@/lib/outcome';

export function invoiceTitle(i: InvoiceSummary) {
  return i.vendorName ?? i.fileName ?? t('Invoice');
}

/** Responsive list: table on ≥md, stacked cards below. */
export function InvoiceList({ invoices, compact = false, actions }: { invoices: InvoiceSummary[]; compact?: boolean; actions?: (invoice: InvoiceSummary) => ReactNode }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="caption">
            <tr className="border-b border-hairline">
              <th scope="col" className="px-5 py-2.5 font-normal">{t('Vendor')}</th>
              {!compact && <th scope="col" className="px-3 py-2.5 font-normal">{t('Invoice #')}</th>}
              <th scope="col" className="px-3 py-2.5 text-right font-normal">{t('Amount')}</th>
              <th scope="col" className="px-3 py-2.5 font-normal">{t('Due')}</th>
              {!compact && <th scope="col" className="px-3 py-2.5 font-normal">{t('Source')}</th>}
              <th scope="col" className="px-3 py-2.5 font-normal">{t('Status')}</th>
              {actions && <th scope="col" className="px-3 py-2.5 font-normal">{t('Actions')}</th>}
              <th scope="col" className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {invoices.map((i) => {
              const o = getOutcome(i);
              return (
                <tr key={i.id} className="group hover:bg-bone">
                  <td className="px-5 py-3">
                    <Link to={`/app/bills/${i.id}`} className="text-ink underline-offset-2 hover:underline">
                      {invoiceTitle(i)}
                    </Link>
                    <div className="text-xs text-slate-400">{timeAgo(i.receivedAt)}</div>
                  </td>
                  {!compact && <td className="text-data px-3 py-3 text-xs">{i.invoiceNumber ?? '—'}</td>}
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{formatMoney(i.amountMinor, i.currency)}</td>
                  <td className="px-3 py-3 text-slate-500">{i.dueDate ? dueLabel(i.dueDate) : '—'}</td>
                  {!compact && (
                    <td className="px-3 py-3">
                      <SourceBadge source={i.source} agentName={i.requestingAgentName} />
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <OutcomeBadge outcome={o} />
                    {o === 'PROCESSING' && <span className="ml-2 text-xs text-slate-400">{processingLabel(i.status)}</span>}
                  </td>
                  {actions && <td className="px-3 py-2">{actions(i)}</td>}
                  <td className="pr-4 text-slate-300 group-hover:text-ink">
                    <ChevronRight className="size-4" aria-hidden />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-hairline md:hidden">
        {invoices.map((i) => (
          <li key={i.id}>
            <Link to={`/app/bills/${i.id}`} className="block px-4 py-3 hover:bg-bone">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-ink">{invoiceTitle(i)}</p>
                  <p className="text-xs text-slate-500">
                    {i.invoiceNumber ?? t('No number')} · {i.dueDate ? dueLabel(i.dueDate) : t('No due date')}
                  </p>
                </div>
                <p className="tabular-nums text-ink">{formatMoney(i.amountMinor, i.currency)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <OutcomeBadge outcome={getOutcome(i)} />
                <SourceBadge source={i.source} agentName={i.requestingAgentName} />
              </div>
            </Link>
            {actions && <div className="px-4 pb-3">{actions(i)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

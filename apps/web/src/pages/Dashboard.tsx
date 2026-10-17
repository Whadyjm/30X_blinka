import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Ban, CalendarClock, CheckCircle2, Clock3, Hand, Upload } from 'lucide-react';
import { OutcomeBadge } from '@/components/Badges';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/Card';
import type { InvoiceSummary } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { InvoiceList, invoiceTitle } from '@/features/invoices/InvoiceList';
import { InboxPreview } from '@/features/integrations/InboxPreview';
import { useInvoices, useMandate } from '@/hooks/queries';
import { t } from '@/i18n';
import { buildBriefing, computeStats } from '@/lib/briefing';
import { daysUntil, dueLabel } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';

export function Dashboard() {
  const invoices = useInvoices();
  const mandate = useMandate();
  const [showAll, setShowAll] = useState(false);
  if (invoices.isError) return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  const list = invoices.data ?? [];
  const stats = computeStats(list);
  const budget = mandate.data?.budget;
  const used = budget && budget.limitMinor > 0
    ? Math.min(100, Math.round((budget.reservedMinor / budget.limitMinor) * 100))
    : budget && budget.reservedMinor > 0 ? 100 : 0;
  const urgent = stats.attention.filter(inv => {
    const days = daysUntil(inv.dueDate);
    return days != null && days <= 2;
  }).length;

  return (
    <section id="organization-overview" aria-label={t('Dashboard')}>
      <PageHeader
        title={t('Dashboard')}
        subtitle={invoices.isLoading ? t('Decisions, reviews and available budget.') : buildBriefing(stats)[0]}
        actions={<Beam><Link to="/app/bills" className={buttonClass('primary', 'md')}><Upload className="size-4" aria-hidden />{t('Upload invoices')}</Link></Beam>}
      />

      <div id="dashboard-stats" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Needs your attention')} value={stats.needsYouCount} icon={<Hand className="size-5" />} tone="amber" to="#dashboard-attention" loading={invoices.isLoading} />
        <Stat label={t('Pending due in 14 days')} value={stats.upcoming.length} icon={<CalendarClock className="size-5" />} tone="indigo" to="#dashboard-attention" loading={invoices.isLoading} />
        <Stat label={t('Approved invoices')} value={stats.approvedCount} icon={<CheckCircle2 className="size-5" />} tone="emerald" to="/app/bills?outcome=APPROVED" loading={invoices.isLoading} />
        <Stat label={t('Blocked invoices')} value={stats.blockedCount} icon={<Ban className="size-5" />} tone="rose" to="/app/bills?outcome=BLOCKED" loading={invoices.isLoading} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card id="dashboard-attention" tabIndex={-1} className={`min-w-0 scroll-mt-6 lg:col-span-2 ${stats.needsYouCount > 0 ? 'border-ink' : ''}`}>
          <CardHeader
            title={t('Needs your attention')}
            subtitle={t('Earliest due dates first. Review the reason for each case.')}
            action={!invoices.isLoading && stats.needsYouCount > 0 ? <span className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-sm tabular-nums text-white">{stats.needsYouCount}</span> : undefined}
          />
          {invoices.isLoading ? <LoadingRows /> : list.length === 0 ? (
            <EmptyState title={t('Start with your first invoice')} body={t('Upload your first invoice and Oli will review it against your rules.')} action={<Link to="/app/bills" className={buttonClass('primary')}>{t('Upload invoices')}</Link>} />
          ) : stats.needsYouCount === 0 ? (
            <EmptyState
              icon={stats.processingCount > 0 ? <Clock3 className="size-6" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
              title={t('No pending interventions.')}
              body={stats.processingCount > 0
                ? t('Oli is still processing invoices. Their decisions will appear here.')
                : t('Review recorded decisions below, including why each invoice was approved or blocked.')}
              action={stats.processingCount > 0 ? <Link to="/app/bills?outcome=PROCESSING" className="text-sm underline underline-offset-4">{t('View processing invoices')}</Link> : undefined}
            />
          ) : (
            <>
              {urgent > 0 && <p className="flex items-center gap-2 border-b border-hairline bg-bone px-5 py-3 text-sm text-ink"><CalendarClock className="size-4 shrink-0" aria-hidden />{urgent === 1 ? t('1 pending invoice is overdue or due within 2 days.') : t('{n} pending invoices are overdue or due within 2 days.', { n: urgent })}</p>}
              <ul className="divide-y divide-hairline">
                {(showAll ? stats.attention : stats.attention.slice(0, 5)).map(inv => <AttentionRow key={inv.id} invoice={inv} />)}
              </ul>
              {stats.needsYouCount > 5 && <div className="border-t border-hairline px-5 py-3"><button type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} className="min-h-11 text-sm underline underline-offset-4">{showAll ? t('Show fewer') : t('Show all {n} pending invoices', { n: stats.needsYouCount })}</button></div>}
            </>
          )}
        </Card>

        <aside className="min-w-0 space-y-6 lg:row-span-3" aria-label={t('Budget and decisions')}>
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base text-ink">{t('Available budget')}</h2>
              {budget && <span className="text-xs text-ash">{budget.periodKey}</span>}
            </div>
            {mandate.isLoading ? <Skeleton className="mt-4 h-20" /> : mandate.isError ? <ErrorState error={mandate.error} onRetry={() => void mandate.refetch()} /> : budget ? (
              <>
                <p className="mt-3 break-words text-2xl tabular-nums text-ink">{formatMoneyWithCode(Math.max(0, budget.limitMinor - budget.reservedMinor), budget.currency)}</p>
                <p className="mt-1 text-sm text-ash">{t('of {total} for the period', { total: formatMoneyWithCode(budget.limitMinor, budget.currency) })}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-sm bg-bone" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label={t('Budget reserved')}>
                  <div className="h-full bg-ink" style={{ width: `${used}%` }} />
                </div>
                <p className="mt-2 text-xs text-ash">{t('{amount} reserved', { amount: formatMoneyWithCode(budget.reservedMinor, budget.currency) })}</p>
              </>
            ) : <p className="mt-3 text-sm text-ash">{t('No budget is configured for this period.')}</p>}
            <Link to="/app/rules" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4">{t('View rules')}<ArrowRight className="size-4" aria-hidden /></Link>
          </Card>

          <Card>
            <CardHeader title={t('Recorded decisions')} subtitle={t('Counts across your invoices.')} />
            {invoices.isLoading ? <LoadingRows /> : (
              <>
                <div className="divide-y divide-hairline">
                  <Link to="/app/bills?outcome=APPROVED" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-bone">
                    <span className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4" aria-hidden />{t('Approved invoices')}</span><span className="text-xl tabular-nums">{stats.approvedCount}</span>
                  </Link>
                  <Link to="/app/bills?outcome=BLOCKED" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-bone">
                    <span className="flex items-center gap-2 text-sm"><Ban className="size-4" aria-hidden />{t('Blocked invoices')}</span><span className="text-xl tabular-nums">{stats.blockedCount}</span>
                  </Link>
                  {stats.processingCount > 0 && <Link to="/app/bills?outcome=PROCESSING" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-bone"><span className="flex items-center gap-2 text-sm"><Clock3 className="size-4" aria-hidden />{t('Processing')}</span><span className="text-xl tabular-nums">{stats.processingCount}</span></Link>}
                </div>
                {stats.approvedCount > 0 && <div className="space-y-1 border-t border-hairline px-5 py-4"><p className="text-xs text-ash">{t('Approved amounts by currency')}</p>{Object.entries(stats.approvedMinor).map(([currency, amount]) => <p key={currency} className="text-sm tabular-nums">{formatMoneyWithCode(amount, currency)}</p>)}</div>}
              </>
            )}
          </Card>
        </aside>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title={t('Recent activity')} action={<Link to="/app/bills" className="shrink-0 text-sm underline underline-offset-4">{t('View all')}</Link>} />
          {invoices.isLoading ? <LoadingRows /> : list.length === 0 ? <p className="px-5 py-6 text-sm text-ash">{t('Recorded decisions will appear here after you upload an invoice.')}</p> : <div className="overflow-x-auto"><InvoiceList invoices={list.slice(0, 5)} compact /></div>}
        </Card>
        <div className="min-w-0 lg:col-span-2"><InboxPreview /></div>
      </div>
    </section>
  );
}

const TONES = {
  emerald: 'bg-highlighter text-ink',
  rose: 'bg-ink text-white',
  amber: 'bg-white text-ink ring-1 ring-inset ring-ink',
  indigo: 'bg-bone text-ink',
} as const;

function Stat({ label, value, icon, tone, to, loading }: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: keyof typeof TONES;
  to: string;
  loading?: boolean;
}) {
  const className = 'rounded-2xl border border-hairline bg-white p-4 transition-colors hover:border-ink sm:p-5';
  const content = <>
    <div className={`grid size-9 place-items-center rounded-lg ${TONES[tone]}`} aria-hidden>{icon}</div>
    {loading ? <Skeleton className="mt-3 h-8 w-12" /> : <p className="mt-3 text-[28px] leading-none tabular-nums text-ink">{value}</p>}
    <p className="mt-1 text-sm text-ash">{label}</p>
  </>;
  return to.startsWith('#')
    ? <a href={to} className={className}>{content}</a>
    : <Link to={to} className={className}>{content}</Link>;
}

function AttentionRow({ invoice }: { invoice: InvoiceSummary }) {
  const outcome = getOutcome(invoice);
  const days = daysUntil(invoice.dueDate);
  const urgent = days != null && days <= 2;
  const reason = outcome === 'FAILED'
    ? invoice.failureReason || t('Processing failed. Open the invoice to review the error.')
    : invoice.decision?.explanation || invoice.approval?.reason || (invoice.decision?.reasons[0] ? reasonInfo(invoice.decision.reasons[0]).label : t('Open the invoice to review what needs attention.'));
  const action = outcome === 'NEEDS_APPROVAL' ? t('Review request') : outcome === 'FAILED' ? t('View error') : t('Review details');
  return (
    <li>
      <Link to={`/app/bills/${invoice.id}`} className="group block px-5 py-4 hover:bg-bone">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            <h3 className="break-words text-base text-ink group-hover:underline group-hover:underline-offset-4">{invoiceTitle(invoice)}</h3>
            {invoice.invoiceNumber && <p className="mt-0.5 break-all text-xs text-ash">{invoice.invoiceNumber}</p>}
          </div>
          <p className="text-base tabular-nums text-ink">{formatMoneyWithCode(invoice.amountMinor, invoice.currency)}</p>
        </div>
        <p className="mt-2 break-words text-sm leading-relaxed text-slate-600">{reason}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={outcome} /><span className={`text-xs ${urgent ? 'text-ink underline decoration-dotted underline-offset-4' : 'text-ash'}`}>{dueLabel(invoice.dueDate)}</span></div>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink">{action}<ArrowRight className="size-4" aria-hidden /></span>
        </div>
      </Link>
    </li>
  );
}

function LoadingRows() {
  return <div className="space-y-3 p-5" role="status" aria-label={t('Loading')}>{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>;
}

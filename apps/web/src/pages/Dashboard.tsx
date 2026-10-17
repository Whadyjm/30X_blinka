import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Ban, CalendarClock, CheckCircle2, Hand, Upload } from 'lucide-react';
import { OutcomeBadge } from '@/components/Badges';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { brand } from '@/config/brand';
import { useInvoices, useMandate } from '@/hooks/queries';
import { t } from '@/i18n';
import { buildBriefing, computeStats } from '@/lib/briefing';
import { dueLabel, isOverdue } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';
import { InvoiceList, invoiceTitle } from '@/features/invoices/InvoiceList';
import { InboxPreview } from '@/features/integrations/InboxPreview';

export function Dashboard() {
  const invoices = useInvoices();
  const mandate = useMandate();
  if (invoices.isError) return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  const list = invoices.data ?? [];
  const stats = computeStats(list);
  const briefing = buildBriefing(stats);
  const budget = mandate.data?.budget;
  const used = budget && budget.limitMinor > 0 ? Math.min(100, Math.round((budget.reservedMinor / budget.limitMinor) * 100)) : null;
  return (<div className="space-y-8">
      <section id="organization-overview" aria-label={t('Overview')} className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-normal text-ink">{t('Organization Overview')}</h2>
            <p className="text-sm text-slate-500">
              {t('Live activity evaluated against your finance mandate.')}
            </p>
          </div>
          <Beam>
            <Link to="/app/bills" className={buttonClass('primary', 'md')}>
              <Upload className="size-4" aria-hidden /> {t('Upload invoices')}
            </Link>
          </Beam>
        </div>

        {/* 4 Summary Stat Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            loading={invoices.isLoading}
            label={t('Approved invoices')}
            value={stats.approvedCount}
            icon={<CheckCircle2 className="size-5" />}
            tone="emerald"
            to="/app/bills?outcome=APPROVED"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Blocked')}
            value={stats.blockedCount}
            icon={<Ban className="size-5" />}
            tone="rose"
            to="/app/bills?outcome=BLOCKED"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Needs you')}
            value={stats.needsYouCount}
            icon={<Hand className="size-5" />}
            tone="amber"
            to="/app/approvals"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Due in 14 days')}
            value={stats.upcoming.length}
            icon={<CalendarClock className="size-5" />}
            tone="indigo"
            to="/app/bills"
          />
        </div>

        {/* 2 Column + 1 Column Layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Primary Column (2 cols) */}
          <div className="space-y-6 lg:col-span-2">
            <InboxPreview />

            <Card>
              <CardHeader
                title={t('Recent activity')}
                action={
                  <Link to="/app/bills" className="text-sm text-ink underline underline-offset-2">
                    {t('View all')}
                  </Link>
                }
              />
              {invoices.isLoading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  title={t('No invoices yet')}
                  body={t('Upload your first invoice and Oli will review it against your rules.')}
                  action={
                    <Link to="/app/bills" className={buttonClass('primary')}>
                      {t('Upload invoices')}
                    </Link>
                  }
                />
              ) : (
                <InvoiceList invoices={list.slice(0, 6)} compact />
              )}
            </Card>
          </div>

          {/* Secondary Column (1 col) */}
          <div className="space-y-6">
            {/* Briefing Card */}
            <Card className="border-obsidian bg-obsidian text-white">
              <div className="p-5">
                <h3 className="caption !text-slate-400">
                  {t('{name}’s briefing', { name: brand.name })}
                </h3>
                {invoices.isLoading ? (
                  <Skeleton className="mt-3 h-16 opacity-30" />
                ) : (
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white">
                    {briefing.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/* Budget Progress Card */}
            {budget && used != null && (
              <Card className="p-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm text-ink">
                    {t('Budget · {period}', { period: budget.periodKey })}
                  </h3>
                  <span className="text-xs text-slate-500">{t('{n}% reserved', { n: used })}</span>
                </div>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-sm bg-bone ring-1 ring-inset ring-hairline"
                  role="progressbar"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('Budget reserved')}
                >
                  <div
                    className={used >= 70 ? 'h-full bg-ink' : 'h-full bg-highlighter'}
                    style={{ width: `${used}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {t('{left} left of {total}', {
                    left: formatMoney(Math.max(0, budget.limitMinor - budget.reservedMinor), budget.currency),
                    total: formatMoney(budget.limitMinor, budget.currency),
                  })}
                </p>
              </Card>
            )}

            {/* Coming Due Card */}
            <Card>
              <CardHeader title={t('Coming due')} />
              {stats.upcoming.length === 0 && stats.overdue.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">
                  {t('Nothing due in the next two weeks.')}
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {[...stats.overdue, ...stats.upcoming].slice(0, 5).map((inv) => (
                    <li key={inv.id}>
                      <Link
                        to={`/app/bills/${inv.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-bone"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{invoiceTitle(inv)}</p>
                          <p
                            className={`text-xs ${
                              isOverdue(inv.dueDate)
                                ? 'text-ink underline decoration-dotted underline-offset-2'
                                : 'text-slate-500'
                            }`}
                          >
                            {dueLabel(inv.dueDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm tabular-nums text-ink">
                            {formatMoney(inv.amountMinor, inv.currency)}
                          </p>
                          <OutcomeBadge outcome={getOutcome(inv)} className="mt-1" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}

const TONES = {
  emerald: 'bg-highlighter text-ink',
  rose: 'bg-ink text-white',
  amber: 'bg-white text-ink ring-1 ring-inset ring-ink',
  indigo: 'bg-bone text-ink',
} as const;

function Stat({
  label,
  value,
  icon,
  tone,
  to,
  loading,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: keyof typeof TONES;
  to: string;
  loading?: boolean;
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-hairline bg-white p-5 transition-colors hover:border-ink"
    >
      <div className={`grid size-9 place-items-center rounded-lg ${TONES[tone]}`} aria-hidden>
        {icon}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p className="mt-3 text-[28px] leading-none tabular-nums text-ink">{value}</p>
      )}
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </Link>
  );
}

import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { CalendarClock, CheckCircle2, Hand, Ban, Upload } from 'lucide-react';
import { OutcomeBadge } from '@/components/Badges';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { brand } from '@/config/brand';
import { useInvoices, useMandate, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { buildBriefing, computeStats } from '@/lib/briefing';
import { dueLabel, isOverdue } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';
import { InvoiceList, invoiceTitle } from '@/features/invoices/InvoiceList';

export function Home() {
  const me = useMe();
  const invoices = useInvoices();
  const mandate = useMandate();

  if (invoices.isError) return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;

  const list = invoices.data ?? [];
  const stats = computeStats(list);
  const briefing = buildBriefing(stats);
  const budget = mandate.data?.budget;
  const used = budget && budget.limitMinor > 0 ? Math.min(100, Math.round((budget.reservedMinor / budget.limitMinor) * 100)) : null;
  const firstName = me.data?.user.name?.split(' ')[0];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{firstName ? t('Hi {name}', { name: firstName }) : t('Hi there')}</p>
          <h1 className="text-[40px] leading-[1.05] text-ink">{brand.tagline}</h1>
        </div>
        <Beam>
          <Link to="/app/bills" className={buttonClass('primary', 'lg')}>
            <Upload className="size-5" aria-hidden /> {t('Upload invoices')}
          </Link>
        </Beam>
      </div>

      <section aria-label={t('Summary')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat loading={invoices.isLoading} label={t('Approved invoices')} value={stats.approvedCount} icon={<CheckCircle2 className="size-5" />} tone="emerald" to="/app/bills?outcome=APPROVED" />
        <Stat loading={invoices.isLoading} label={t('Blocked')} value={stats.blockedCount} icon={<Ban className="size-5" />} tone="rose" to="/app/bills?outcome=BLOCKED" />
        <Stat loading={invoices.isLoading} label={t('Needs you')} value={stats.needsYouCount} icon={<Hand className="size-5" />} tone="amber" to="/app/approvals" />
        <Stat loading={invoices.isLoading} label={t('Due in 14 days')} value={stats.upcoming.length} icon={<CalendarClock className="size-5" />} tone="indigo" to="/app/bills" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('Recent activity')} action={<Link to="/app/bills" className="text-sm text-ink underline underline-offset-2">{t('View all')}</Link>} />
            {invoices.isLoading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : list.length === 0 ? (
              <EmptyState title={t('No invoices yet')} body={t('Upload your first invoice and Oli will review it against your rules.')} action={<Link to="/app/bills" className={buttonClass('primary')}>{t('Upload invoices')}</Link>} />
            ) : (
              <InvoiceList invoices={list.slice(0, 6)} compact />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-obsidian bg-obsidian text-white">
            <div className="p-5">
              <h2 className="caption !text-slate-400">{t('{name}’s briefing', { name: brand.name })}</h2>
              {invoices.isLoading ? (
                <Skeleton className="mt-3 h-16 opacity-30" />
              ) : (
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white">
                  {briefing.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              )}
            </div>
          </Card>

          {budget && used != null && (
            <Card className="p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm text-ink">{t('Budget · {period}', { period: budget.periodKey })}</h2>
                <span className="text-xs text-slate-500">{t('{n}% reserved', { n: used })}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-sm bg-bone ring-1 ring-inset ring-hairline" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label={t('Budget reserved')}>
                <div className={used >= 70 ? 'h-full bg-ink' : 'h-full bg-highlighter'} style={{ width: `${used}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {t('{left} left of {total}', { left: formatMoney(Math.max(0, budget.limitMinor - budget.reservedMinor), budget.currency), total: formatMoney(budget.limitMinor, budget.currency) })}
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title={t('Coming due')} />
            {stats.upcoming.length === 0 && stats.overdue.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">{t('Nothing due in the next two weeks.')}</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {[...stats.overdue, ...stats.upcoming].slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <Link to={`/app/bills/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-bone">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{invoiceTitle(i)}</p>
                        <p className={`text-xs ${isOverdue(i.dueDate) ? 'text-ink underline decoration-dotted underline-offset-2' : 'text-slate-500'}`}>{dueLabel(i.dueDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm tabular-nums text-ink">{formatMoney(i.amountMinor, i.currency)}</p>
                        <OutcomeBadge outcome={getOutcome(i)} className="mt-1" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

const TONES = {
  emerald: 'bg-highlighter text-ink',
  rose: 'bg-ink text-white',
  amber: 'bg-white text-ink ring-1 ring-inset ring-ink',
  indigo: 'bg-bone text-ink',
} as const;

function Stat({ label, value, icon, tone, to, loading }: { label: string; value: number; icon: ReactNode; tone: keyof typeof TONES; to: string; loading?: boolean }) {
  return (
    <Link to={to} className="rounded-2xl border border-hairline bg-white p-5 transition-colors hover:border-ink">
      <div className={`grid size-9 place-items-center rounded-lg ${TONES[tone]}`} aria-hidden>
        {icon}
      </div>
      {loading ? <Skeleton className="mt-3 h-8 w-12" /> : <p className="mt-3 text-[28px] leading-none tabular-nums text-ink">{value}</p>}
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </Link>
  );
}

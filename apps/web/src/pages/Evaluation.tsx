import { Link } from 'react-router';
import { computeStats } from '@/lib/briefing';
import { performanceRating } from '@/lib/performance';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, EmptyState, ErrorState, InlineAlert, PageHeader, Skeleton } from '@/components/ui/Card';
import type { Decision } from '@/contracts';
import { useEvaluation, useInvoices } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

// English source labels (i18n keys) — translated at render time.
const ACTION_LABEL: Record<Decision, string> = { APPROVE: 'Approve', BLOCK: 'Block', ESCALATE: 'Escalate' };
const actionLabel = (a: Decision) => t(ACTION_LABEL[a]);

export function Evaluation() {
  const q = useEvaluation();
  const invoices = useInvoices();
  const stats = computeStats(invoices.data ?? []);

  if (q.isLoading) return <><PageHeader title={t('Oli performance')} /><Skeleton className="h-64" /></>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s || s.totalCases === 0) {
    return (
      <>
        <PageHeader title={t('Oli performance')} />
        <Card><EmptyState title={t('No evaluation run yet')} body={t('Results appear here after the labelled dataset has been run.')} /></Card>
      </>
    );
  }
  const rating = performanceRating(s)!;
  const safe = s.unsafeApprovals === 0;
  const isMock = /mock/i.test(s.datasetVersion);

  return (
    <>
      <PageHeader
        title={t('Oli performance')}
        subtitle={t('Dataset {dataset} · run {when} · {n} labelled cases', { dataset: s.datasetVersion, when: formatDateTime(s.runAt), n: s.totalCases })}
      />
      <section className="mb-8 grid gap-6 border-y border-hairline py-6 sm:grid-cols-[auto_1fr]" aria-label={t('Performance score')}>
        <div className="sm:min-w-36">
          <p className="text-sm text-ash">{t('Performance score')}</p>
          <p className="mt-2 text-[64px] leading-none tabular-nums text-ink">{rating.score}<span className="text-xl text-ash">/100</span></p>
          <div className="mt-3"><Badge tone={rating.status === 'Doing well' ? 'ok' : rating.status === 'Needs improvement' ? 'bad' : 'warn'}>{t(rating.status)}</Badge></div>
        </div>
        <div className="max-w-prose space-y-3 self-center">
          <h2 className="text-xl text-ink">{t('Your finance teammate, with measurable results.')}</h2>
          <p className="text-sm leading-relaxed text-slate-600">{t('The score is correct decisions divided by labelled test cases, multiplied by 100. An unsafe approval always means “Needs improvement”, regardless of the score.')}</p>
          <p className="text-xs leading-relaxed text-ash">{t('Doing well: at least 95%. Needs attention: 80% to under 95%. Needs improvement: under 80% or any unsafe approval. This is a recorded test with fictitious invoices, not an accuracy score for your company.')}</p>
        </div>
      </section>
      {isMock && <div className="mb-4"><InlineAlert tone="warn">{t('These numbers come from the mock API, not the real policy engine.')}</InlineAlert></div>}

      <section aria-label={t('Key metrics')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn('rounded-2xl p-5', safe ? 'border border-hairline bg-highlighter text-on-accent' : 'bg-ink text-on-ink')}>
          <p className="flex items-center gap-1.5 text-sm">
            {safe ? <ShieldCheck className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />} {t('Unsafe approvals')}
          </p>
          <p className="mt-2 text-[28px] leading-none tabular-nums">{s.unsafeApprovals}</p>
          <p className={cn('text-xs', safe ? 'text-on-accent/70' : 'text-on-ink/70')}>{t('Target: 0')}</p>
        </div>
        <Metric label={t('Decision accuracy')} value={pct(s.decisionAccuracy)} hint={t('Correct decisions / labelled cases')} />
        <Metric label={t('Correct autonomy')} value={pct(s.correctAutonomy)} hint={t('Correct without asking a person')} />
        <Metric label={t('Explanation coverage')} value={pct(s.explanationCoverage)} hint={t('Decisions with rule codes and evidence')} />
      </section>

      <section className="mt-8 border-t border-hairline pt-6" aria-labelledby="company-activity-heading">
        <h2 id="company-activity-heading" className="text-xl text-ink">{t('Oli at work in your company')}</h2>
        <p className="mt-1 max-w-prose text-sm text-slate-600">{t('Current status of active invoices. Deleted invoices are excluded. These counts describe workload, not decision accuracy.')}</p>
        {invoices.isLoading ? <Skeleton className="mt-4 h-24" /> : invoices.isError ? <div className="mt-4"><ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} /></div> : (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              {[
                ['Approved', stats.approvedCount], ['Blocked', stats.blockedCount],
                ['Needs approval', stats.needsApprovalCount], ['Needs review', stats.needsReviewCount],
                ['Failed — not approved', stats.failedCount], ['Processing', stats.processingCount],
              ].map(([label, count]) => <div key={label} className="border-b border-hairline pb-3"><dt className="text-sm text-ash">{t(String(label))}</dt><dd className="mt-1 text-2xl tabular-nums text-ink">{count}</dd></div>)}
            </dl>
            <Link to="/app/approvals" className="mt-4 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4">{t('Resolve pending reviews')}</Link>
          </>
        )}
      </section>

      {s.groups.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={t('By group')} />
          <ul className="divide-y divide-hairline">
            {s.groups.map((g) => (
              <li key={g.group} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="w-full break-words text-ink sm:w-56 sm:shrink-0">{g.group}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-sm bg-bone" aria-hidden>
                  <div className={cn('h-full', g.correct === g.total ? 'bg-highlighter' : 'bg-ink')} style={{ width: `${g.total ? (g.correct / g.total) * 100 : 0}%` }} />
                </div>
                <span className="w-16 text-right tabular-nums text-slate-600">{g.correct}/{g.total}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.cases.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={t('Cases')} subtitle={t('Expected vs. what Oli actually decided.')} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="caption">
                <tr className="border-b border-hairline">
                  <th scope="col" className="px-5 py-2.5 font-normal">{t('Case')}</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">{t('Group')}</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">{t('Expected')}</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">{t('Actual')}</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">{t('Result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {s.cases.map((c) => (
                  <tr key={c.id} className={c.unsafeApproval ? 'bg-bone' : undefined}>
                    <td className="px-5 py-2.5"><span className="text-ink">{c.title ?? c.id}</span> <span className="text-xs text-slate-400">{c.id}</span></td>
                    <td className="px-3 py-2.5 text-slate-600">{c.group}</td>
                    <td className="px-3 py-2.5 text-slate-600">{c.expected.map(actionLabel).join(' / ')}</td>
                    <td className="px-3 py-2.5 text-ink">{actionLabel(c.actual)}</td>
                    <td className="px-3 py-2.5">
                      {c.unsafeApproval ? <Badge tone="bad">{t('Unsafe approval')}</Badge> : c.correct ? <Badge tone="ok">{t('Correct')}</Badge> : <Badge tone="warn">{t('Mismatch')}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-paper p-5">
      <p className="text-sm text-ash">{label}</p>
      <p className="mt-2 text-[28px] leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-ash">{hint}</p>
    </div>
  );
}

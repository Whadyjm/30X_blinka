import { useState } from 'react';
import { Link } from 'react-router';
import { Hand } from 'lucide-react';
import { OutcomeBadge, ReasonChips } from '@/components/Badges';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/Card';
import { ApprovalPanel } from '@/features/approvals/ApprovalPanel';
import { useApprovals } from '@/hooks/queries';
import { humanize } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatDate, formatDateTime, timeAgo } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';
import type { ApprovalRequest } from '@/contracts';

// Resolved approval states (English i18n keys).
const STATE_LABEL: Record<string, string> = { APPROVED: 'approved', REJECTED: 'rejected', INVALIDATED: 'invalidated', EXPIRED: 'expired' };
const stateLabel = (s: string) => (STATE_LABEL[s] ? t(STATE_LABEL[s]) : humanize(s).toLowerCase());

export function Approvals() {
  const q = useApprovals();
  const [showHistory, setShowHistory] = useState(false);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const all = q.data ?? [];
  const pending = all.filter((a) => a.state === 'PENDING');
  const resolved = all.filter((a) => a.state !== 'PENDING');

  return (
    <>
      <PageHeader title={t('Approvals')} subtitle={t('Exceptions your policy lets a person decide. Oli re-checks everything before confirming.')} />

      {q.isLoading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : pending.length === 0 ? (
        <Card>
          <EmptyState icon={<Hand className="size-6" aria-hidden />} title={t('Nothing needs you right now')} body={t('When an invoice needs a human decision, it will show up here.')} />
        </Card>
      ) : (
        <ul className="space-y-4">
          {pending.map((a) => (
            <li key={a.id}>
              <PendingCard a={a} />
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <section className="mt-10">
          <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)} className="text-sm text-ink underline underline-offset-2">
            {showHistory ? t('Hide resolved ({n})', { n: resolved.length }) : t('Show resolved ({n})', { n: resolved.length })}
          </button>
          {showHistory && (
            <Card className="mt-3">
              <ul className="divide-y divide-hairline">
                {resolved.map((a) => {
                  const reviewer = a.invoice?.approval?.reviewerName;
                  const when = a.invoice?.approval?.decidedAt;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <Link to={`/app/bills/${a.invoiceId}`} className="text-ink underline-offset-2 hover:underline">
                          {a.invoice?.vendorName ?? a.invoiceId}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {stateLabel(a.state)}
                          {reviewer ? ` ${t('by {name}', { name: reviewer })}` : ''}
                          {when ? ` · ${formatDateTime(when)}` : ''}
                        </p>
                      </div>
                      {a.invoice && <OutcomeBadge outcome={getOutcome(a.invoice)} />}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      )}
    </>
  );
}

function PendingCard({ a }: { a: ApprovalRequest }) {
  const inv = a.invoice;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <Link to={`/app/bills/${a.invoiceId}`} className="text-xl text-ink underline-offset-2 hover:underline">
            {inv?.vendorName ?? t('Invoice')} {inv?.invoiceNumber && <span className="text-data text-sm text-ash">· {inv.invoiceNumber}</span>}
          </Link>
          <p className="text-sm text-slate-500">{t('Due {date} · requested {when}', { date: formatDate(inv?.dueDate), when: timeAgo(a.createdAt) })}</p>
        </div>
        <p className="text-2xl tabular-nums text-ink">{formatMoneyWithCode(inv?.amountMinor, inv?.currency)}</p>
      </div>
      <div className="space-y-4 p-5">
        <div>
          <p className="caption mb-1.5">{t('Why Oli can’t approve this alone')}</p>
          <p className="text-[15px] text-ink">{a.reason ?? inv?.decision?.explanation ?? t('This exception needs a person.')}</p>
          <div className="mt-2">
            <ReasonChips reasons={a.reasons.length ? a.reasons : (inv?.decision?.reasons ?? [])} />
          </div>
        </div>
        <ApprovalPanel approvalId={a.id} expectedDecisionId={a.decisionId} expectedPolicyVersionId={a.policyVersionId} canDecide={a.canDecide ?? false} cannotDecideReason={a.cannotDecideReason} />
        <Link to={`/app/bills/${a.invoiceId}`} className="inline-block text-sm text-ink underline underline-offset-2">
          {t('Open full decision trace')}
        </Link>
      </div>
    </Card>
  );
}

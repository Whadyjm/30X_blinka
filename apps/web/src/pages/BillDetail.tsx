import { Link, useParams } from 'react-router';
import { ArrowLeft, Check } from 'lucide-react';
import { ApiError, errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { OutcomeBadge, ReasonChips, SourceBadge } from '@/components/Badges';
import { DecisionTrace } from '@/components/DecisionTrace';
import { DocumentViewer } from '@/components/DocumentViewer';
import { ExtractionPanel } from '@/components/ExtractionPanel';
import { Card, CardHeader, ErrorState, InlineAlert, PageLoading } from '@/components/ui/Card';
import { Orb } from '@/components/ui/Orb';
import { brand } from '@/config/brand';
import type { AuditEvent, InvoiceDetail } from '@/contracts';
import { DECISION_LABEL, humanize } from '@/contracts/reasons';
import { ApprovalPanel } from '@/features/approvals/ApprovalPanel';
import { useInvoice, useMe, useProcessInvoice } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { dueLabel, formatDate, formatDateTime } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { getOutcome, PROCESSING_STEPS, processingLabel } from '@/lib/outcome';

// English source labels (i18n keys) — translated at render time.
const EVENT_LABEL: Record<string, string> = {
  INVOICE_RECEIVED: 'Invoice received',
  EXTRACTION_COMPLETED: 'Document read',
  DECISION_RECORDED: 'Decision recorded',
  APPROVAL_REQUESTED: 'Human approval requested',
  APPROVAL_APPROVED: 'Approved by a reviewer',
  APPROVAL_REJECTED: 'Rejected by a reviewer',
  APPROVAL_REVALIDATION_FAILED: 'Re-check failed — not approved',
  BUDGET_RESERVED: 'Budget reserved (simulated)',
};

export function BillDetail() {
  const { id = '' } = useParams();
  const q = useInvoice(id);
  const me = useMe();
  const process = useProcessInvoice();

  if (q.isLoading) return <PageLoading label={t('Loading invoice')} />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorState error={q.error} title={notFound ? t('Invoice not found') : undefined} onRetry={notFound ? undefined : () => void q.refetch()} />;
  }
  const inv = q.data;
  if (!inv) return null;

  const outcome = getOutcome(inv);
  const d = inv.decision;
  const pendingApproval = inv.approval?.state === 'PENDING' ? inv.approval : null;
  const role = me.data?.role;
  const canDecide = role === 'owner' || role === 'approver';

  return (
    <>
      <Link to="/app/bills" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t('Bills')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] leading-[1.14] text-ink">{inv.vendorName ?? inv.fileName ?? t('Invoice')}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span className="text-data text-[13px]">{inv.invoiceNumber ?? inv.id}</span>
            <SourceBadge source={inv.source} agentName={inv.requestingAgentName} />
            <span>{t('Received {when}', { when: formatDateTime(inv.receivedAt) })}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[28px] leading-[1.14] tabular-nums text-ink">{formatMoneyWithCode(inv.amountMinor, inv.currency)}</p>
          <p className="text-sm text-slate-500">{inv.dueDate ? `${formatDate(inv.dueDate)} · ${dueLabel(inv.dueDate)}` : t('No due date')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* left: document + extraction */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('Original document')} subtitle={inv.fileName ?? undefined} />
            <div className="p-4">
              <DocumentViewer invoice={inv} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t('What Oli read')} subtitle={t('Extraction only — Oli doesn’t decide from this alone.')} />
            <ExtractionPanel extracted={inv.extracted} pending={outcome === 'PROCESSING'} />
          </Card>
        </div>

        {/* right: decision */}
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-4">
              <h2 className="text-base text-ink">{t('Decision')}</h2>
              <OutcomeBadge outcome={outcome} className="text-sm" />
            </div>
            <div className="space-y-4 p-5">
              {outcome === 'PROCESSING' && <ProcessingSteps status={inv.status} />}
              {outcome === 'PROCESSING' && <Button variant="secondary" onClick={() => void q.refresh()} loading={q.isFetching}>{t('Refresh')}</Button>}

              {outcome === 'FAILED' && (
                <InlineAlert>
                  {inv.failureReason
                    ? inv.failureReason
                    : t('Processing failed. Nothing was approved.')}
                </InlineAlert>
              )}
              {outcome === 'FAILED' && inv.retryable && <Button onClick={() => process.mutate(inv.id)} loading={process.isPending}>{t('Retry processing')}</Button>}
              {process.isError && <InlineAlert>{errorMessage(process.error)}</InlineAlert>}

              {d && (
                <>
                  <p className="text-[15px] leading-relaxed text-ink">{d.explanation || t('No explanation was recorded.')}</p>
                  <ReasonChips reasons={d.reasons} />
                  <p className="text-xs text-slate-500">
                    {t('Policy v{n}', { n: String(d.policyVersion ?? '?') })} · {d.checkedAt ? formatDateTime(d.checkedAt) : t('time not recorded')} ·{' '}
                    {outcome === 'APPROVED' ? brand.approveLabel : t('Simulated — no real money')}
                  </p>
                </>
              )}

              {inv.approval && inv.approval.state !== 'PENDING' && <ApprovalResult approval={inv.approval} />}

              {pendingApproval && (
                <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-ink">
                  <h3 className="mb-1 text-sm text-ink">{t('Oli needs your decision')}</h3>
                  <p className="mb-3 text-sm text-slate-600">{t('Oli doesn’t have the authority to approve this on its own. Your policy lets an owner or approver decide.')}</p>
                  <ApprovalPanel approvalId={pendingApproval.id} expectedDecisionId={pendingApproval.decisionId} expectedPolicyVersionId={pendingApproval.policyVersionId}
                    canDecide={canDecide && pendingApproval.canDecide === true} cannotDecideReason={t('Only an owner or approver can decide exceptions.')} />
                </div>
              )}

              {outcome === 'NEEDS_REVIEW' && !pendingApproval && <NotApprovable inv={inv} />}
            </div>
          </Card>

          {d && (
            <Card>
              <CardHeader title={t('Decision trace')} subtitle={t('Each rule Oli checked, what it found, and the result.')} />
              <DecisionTrace decision={d} />
            </Card>
          )}

          {inv.audit.length > 0 && <Card>
            <CardHeader title={t('Audit log')} subtitle={t('Append-only. Past entries are never edited.')} />
            <Timeline events={inv.audit} />
          </Card>}

          {inv.decisionHistory.length > 0 && (
            <Card>
              <CardHeader title={t('Earlier decisions')} />
              <ul className="divide-y divide-hairline">
                {inv.decisionHistory.map((h, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <p className="text-ink">
                      {t(DECISION_LABEL[h.decision])} · {t('policy v{n}', { n: String(h.policyVersion ?? '?') })} · {formatDateTime(h.checkedAt)}
                    </p>
                    <p className="text-slate-600">{h.explanation}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ProcessingSteps({ status }: { status: string }) {
  const idx = Math.max(0, PROCESSING_STEPS.indexOf(status as (typeof PROCESSING_STEPS)[number]));
  const labels = ['Received', 'Reading', 'Ready', 'Checking rules', 'Decided']; // English i18n keys
  return (
    <div role="status" aria-live="polite">
      <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <Orb size={20} state={status === 'PARSING' ? 'searching' : status === 'PROCESSING' ? 'solving' : 'working'} /> {processingLabel(status)}
      </p>
      <ol className="flex items-center gap-1.5">
        {labels.map((l, i) => (
          <li key={l} className="flex flex-1 flex-col gap-1">
            <span className={cn('h-1.5 rounded-sm', i <= idx ? 'bg-ink' : 'bg-smoke')} />
            <span className={cn('text-[11px]', i <= idx ? 'text-slate-700' : 'text-slate-400')}>{t(l)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ApprovalResult({ approval }: { approval: NonNullable<InvoiceDetail['approval']> }) {
  const label =
    approval.state === 'APPROVED'
      ? t('Approved by')
      : approval.state === 'REJECTED'
        ? t('Rejected by')
        : approval.state === 'INVALIDATED'
          ? t('Human approval invalidated')
          : approval.state === 'EXPIRED'
            ? t('Human approval expired')
            : t('Human approval {state}', { state: humanize(approval.state).toLowerCase() });
  const tone = approval.state === 'APPROVED' ? 'success' : approval.state === 'REJECTED' ? 'info' : 'warn';
  return (
    <InlineAlert tone={tone}>
      <p className="flex items-center gap-1.5">
        {approval.state === 'APPROVED' && <Check className="size-4" aria-hidden />}
        {label}
        {approval.reviewerName ? ` ${approval.reviewerName}` : ''}
        {approval.decidedAt ? ` · ${formatDateTime(approval.decidedAt)}` : ''}
      </p>
      {approval.justification && <p className="mt-1">“{approval.justification}”</p>}
      {approval.state === 'INVALIDATED' && approval.reason && <p className="mt-1">{approval.reason}</p>}
    </InlineAlert>
  );
}

// English source hints (i18n keys) — translated at render time.
const UNBLOCK: Record<string, string> = {
  INVALID_OR_MISSING_DATA: 'Upload a clearer copy so the missing fields can be read.',
  POSSIBLE_DUPLICATE: 'Confirm it is not a repeat of an earlier invoice, then enable human review for possible duplicates in Rules.',
  AGREEMENT_MISMATCH: 'Correct the agreement, or enable human review for agreement differences in Rules.',
  MISSING_AGREEMENT: 'Add an agreement for this vendor in Rules.',
  AMOUNT_ABOVE_AUTO_LIMIT: 'Enable human approval for amounts above the automatic limit in Rules.',
};

function NotApprovable({ inv }: { inv: InvoiceDetail }) {
  const hints = (inv.decision?.reasons ?? []).map((r) => UNBLOCK[r]).filter((h): h is string => !!h);
  return (
    <InlineAlert tone="warn">
      <p>{t('A human “yes” isn’t allowed for this one.')}</p>
      <p className="mt-0.5">{t('Your current policy doesn’t let anyone approve it as-is. A policy change or corrected data is needed first.')}</p>
      {hints.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {[...new Set(hints)].map((h) => <li key={h}>{t(h)}</li>)}
        </ul>
      )}
    </InlineAlert>
  );
}

function Timeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <p className="px-5 py-4 text-sm text-slate-500">{t('No events recorded yet.')}</p>;
  return (
    <ol className="space-y-0 px-5 py-4">
      {[...events].reverse().map((e, i, arr) => {
        const known = EVENT_LABEL[e.type];
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < arr.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-hairline" aria-hidden />}
            <span className="relative mt-1.5 size-[11px] shrink-0 rounded-sm bg-ink ring-4 ring-white" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="text-ink">{known ? t(known) : humanize(e.type)}</p>
              <p className="text-xs text-slate-500">
                {e.actorName ?? e.actorKind} · {formatDateTime(e.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

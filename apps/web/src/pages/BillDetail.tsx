import { Link, useParams } from 'react-router';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { ApiError, errorMessage } from '@/api';
import { Button, buttonClass } from '@/components/ui/Button';
import { OutcomeBadge, ReasonChips, SourceBadge } from '@/components/Badges';
import { DecisionTrace } from '@/components/DecisionTrace';
import { DocumentViewer } from '@/components/DocumentViewer';
import { ExtractionPanel } from '@/components/ExtractionPanel';
import { InvoiceLogs } from '@/components/InvoiceLogs';
import { Card, CardHeader, ErrorState, InlineAlert, PageLoading } from '@/components/ui/Card';
import { Orb } from '@/components/ui/Orb';
import type { InvoiceDetail } from '@/contracts';
import { humanize } from '@/contracts/reasons';
import { ApprovalPanel } from '@/features/approvals/ApprovalPanel';
import { ManualInvoiceApproval } from '@/features/approvals/ManualInvoiceApproval';
import { useInvoiceTrash, useInvoice, useMandate, useMe, useProcessInvoice, useRereadInvoice, useReevaluateInvoice } from '@/hooks/queries';
import { InvoiceTrashButton } from '@/features/invoices/InvoiceTrashButton';
import { InvoiceTrashHistory } from '@/features/invoices/InvoiceTrashHistory';
import { invoiceTrashState } from '@/lib/invoice-trash';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { dueLabel, formatDate, formatDateTime } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { getOutcome, PROCESSING_STEPS, processingLabel } from '@/lib/outcome';
import { extractionExplanation, invoiceExplanation, readingNeedsReview } from '@/lib/extraction-explanation';

export function BillDetail() {
  const { id = '' } = useParams();
  const q = useInvoice(id);
  const me = useMe();
  const process = useProcessInvoice();
  const reevaluate = useReevaluateInvoice();
  const reread = useRereadInvoice();
  const mandate = useMandate();
  const trash = useInvoiceTrash();

  if (q.isLoading) return <PageLoading label={t('Loading invoice')} />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorState error={q.error} title={notFound ? t('Invoice not found') : undefined} onRetry={notFound ? undefined : () => void q.refetch()} />;
  }
  const inv = q.data;
  if (!inv) return null;

  const trashed = invoiceTrashState(trash.data ?? []).get(inv.id)?.trashed === true;
  const outcome = getOutcome(inv);
  const d = inv.decision;
  const pendingApproval = inv.approval?.state === 'PENDING' ? inv.approval : null;
  const role = me.data?.role;
  const canDecide = role === 'owner' || role === 'approver';
  const resolved = d?.decision === 'APPROVE' || inv.decisionHistory.some(h => h.decision === 'APPROVE')
    || ['APPROVED', 'REJECTED'].includes(inv.approval?.state ?? '');
  const needsNewRead = d?.reasons.some(r => r === 'INVALID_OR_MISSING_DATA' || r === 'DOCUMENT_TYPE_UNCERTAIN') === true;
  const needsVendorOnboarding = d?.reasons.includes('UNKNOWN_VENDOR') === true;
  const reanalysisHint = resolved ? 'An authorized or manually rejected invoice keeps its recorded resolution.'
    : needsNewRead ? 'Read the saved original again to verify the document and its fields. You do not need to upload it again.'
    : needsVendorOnboarding ? 'Resolve the vendor with Oli before updating this review.'
    : role !== 'owner' ? 'Only an owner can reanalyze invoices.'
      : !d?.id || !inv.extracted ? 'A completed document reading is needed before reanalyzing.'
        : 'Checks the current rules using the saved reading. The original document and earlier decisions stay unchanged.';
  const canReread = role === 'owner' && !resolved && !!d?.id && inv.status === 'DECIDED' && !!mandate.data?.active?.id;
  const canReevaluate = role === 'owner' && !resolved && !needsNewRead && !needsVendorOnboarding && !!d?.id && !!inv.extracted && !!mandate.data?.active?.id && outcome !== 'PROCESSING';

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

      {(outcome === 'NEEDS_REVIEW' || outcome === 'NEEDS_APPROVAL' || outcome === 'BLOCKED' || (outcome === 'PROCESSING' && !!d)) && (
        <Card className="mb-6">
          <CardHeader
            title={t(d && readingNeedsReview(d) ? 'Why this invoice is in review' : 'Resolve review')}
            action={<a href="#invoice-logs" className="text-sm text-slate-600 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" onClick={() => {
              const logs = document.getElementById('invoice-logs') as HTMLDetailsElement | null;
              if (logs) logs.open = true;
            }}>{t('Logs')}</a>}
          />
          <div className="space-y-4 p-5">
            {pendingApproval && (
              <div>
                <h3 className="mb-1 text-sm text-ink">{t('Approve or reject this invoice')}</h3>
                <p className="mb-3 text-sm text-slate-600">{t('Oli doesn’t have the authority to approve this on its own. Your policy lets an owner or approver decide.')}</p>
                <ApprovalPanel approvalId={pendingApproval.id} expectedDecisionId={pendingApproval.decisionId} expectedPolicyVersionId={pendingApproval.policyVersionId}
                  canDecide={canDecide && pendingApproval.canDecide === true} cannotDecideReason={t(!canDecide ? 'Only an owner or approver can decide exceptions.' : 'This request uses earlier rules. Update the review before deciding.')} />
              </div>
            )}

            {!pendingApproval && outcome !== 'PROCESSING' && <NotApprovable inv={inv} />}
            {!resolved && outcome !== 'PROCESSING' && !pendingApproval?.canDecide &&
              <ManualInvoiceApproval invoice={inv} policyVersionId={mandate.data?.active?.id} canDecide={canDecide} />}
            {!pendingApproval?.canDecide && <div className="space-y-2 border-t border-hairline pt-4">
              <div className="flex flex-wrap gap-2">
                <Button variant={needsNewRead ? 'primary' : 'secondary'} icon={<RotateCcw className="size-4" aria-hidden />} loading={reread.isPending}
                  disabled={!canReread || reevaluate.isPending} aria-describedby="reanalysis-hint"
                  onClick={() => reread.mutate({ id: inv.id, expectedDecisionId: d!.id!, expectedPolicyVersionId: String(mandate.data!.active!.id) })}>
                  {t(reread.isPending ? 'Requesting a new reading…' : 'Read original again')}
                </Button>
                {!needsNewRead && <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} loading={reevaluate.isPending}
                disabled={!canReevaluate} aria-describedby="reanalysis-hint"
                onClick={() => reevaluate.mutate({ id: inv.id, expectedDecisionId: d!.id!, expectedPolicyVersionId: String(mandate.data!.active!.id) })}>
                {t(reevaluate.isPending ? 'Reanalyzing…' : 'Update review')}
                </Button>}
              </div>
              <p id="reanalysis-hint" className="text-sm text-slate-600">{t(reanalysisHint)}</p>
              {reread.isError && <InlineAlert>{errorMessage(reread.error)}</InlineAlert>}
              {reread.isSuccess && <p role="status" className="text-sm text-slate-600">{t('New reading requested. The original and earlier decisions are preserved.')}</p>}
              {reevaluate.isError && <InlineAlert>{errorMessage(reevaluate.error)}</InlineAlert>}
              {reevaluate.isSuccess && <p role="status" className="text-sm text-slate-600">{t('Analysis updated. The previous decision is in the history.')}</p>}
            </div>}
            {pendingApproval?.canDecide && <p className="text-sm text-slate-600">{t('Approval records an authorization and reserves budget. No payment is executed.')}</p>}
          </div>
        </Card>
      )}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-hairline bg-paper p-4">
        <div className="max-w-prose text-sm leading-relaxed text-slate-600"><p className="text-ink">{t(trashed ? 'This invoice is in Deleted.' : 'Invoice record')}</p><p>{t('The document, decisions and budget reservations are preserved. Moving to Deleted does not cancel processing or authorizations.')}</p></div>
        <InvoiceTrashButton invoiceId={inv.id} title={inv.vendorName ?? inv.fileName ?? inv.id} />
      </div>
      <div className="mb-5"><InvoiceTrashHistory invoiceId={inv.id} /></div>
      <div className="grid gap-6 lg:grid-cols-5">
        {/* left: document + extraction */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('Original document')} subtitle={inv.fileName ?? undefined} />
            <div className="p-4">
              <DocumentViewer invoice={inv} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t('What Oli read')} subtitle={t('Extraction only — Oli doesn’t decide from this alone.')} />
            <ExtractionPanel extracted={inv.extracted} pending={outcome === 'PROCESSING'} confirmed={d?.reasons.includes('HUMAN_APPROVED')} />
          </Card>
        </div>

        {/* right: decision */}
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-4">
              <h2 className="text-base text-ink">{t('Decision')}</h2>
              <OutcomeBadge outcome={outcome} className="text-sm" />
            </div>
            <div className="space-y-4 p-5">
              {outcome === 'PROCESSING' && <ProcessingSteps status={inv.status} />}
              {outcome === 'PROCESSING' && d && <p className="text-sm text-slate-600">{t('The previous decision remains in the history while Oli reads the original again.')}</p>}
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
                  <p className="text-[15px] leading-relaxed text-ink">{readingNeedsReview(d)
                    ? t('This is a reading review, not a request to approve an exception.')
                    : invoiceExplanation(d)}</p>
                  <ReasonChips reasons={d.reasons} />
                  <p className="text-xs text-slate-500">
                    {t('Policy v{n}', { n: String(d.policyVersion ?? '?') })} · {d.checkedAt ? formatDateTime(d.checkedAt) : t('time not recorded')}
                  </p>
                </>
              )}

              {inv.approval && inv.approval.state !== 'PENDING' && <ApprovalResult approval={inv.approval} />}
            </div>
          </Card>

          {d && (
            <Card>
              <CardHeader title={t('Decision trace')} subtitle={t('Each rule Oli checked, what it found, and the result.')} />
              <DecisionTrace decision={d} extracted={inv.extracted} />
            </Card>
          )}

          <InvoiceLogs invoice={inv} />
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
  UNKNOWN_VENDOR: 'Register the vendor and confirm their agreement with Oli before reviewing again.',
  INSUFFICIENT_BUDGET: 'Review the available budget in Rules before reviewing again.',
  INVALID_OR_MISSING_DATA: 'Start by reading the saved original again. Oli will show which fields still need clarification.',
  POSSIBLE_DUPLICATE: 'Clarify the possible duplicate and upload a corrected document. This cannot be approved with an exception.',
  AGREEMENT_MISMATCH: 'Correct the document or agreement before processing a corrected invoice.',
  MISSING_AGREEMENT: 'Add an agreement for this vendor in Rules.',
  AMOUNT_ABOVE_AUTO_LIMIT: 'Enable human approval for amounts above the automatic limit in Rules.',
};

function NotApprovable({ inv }: { inv: InvoiceDetail }) {
  const hints = (inv.decision?.reasons ?? []).map((r) => UNBLOCK[r]).filter((h): h is string => !!h);
  if (inv.decision && readingNeedsReview(inv.decision)) {
    return <InlineAlert tone="warn">
      <p>{extractionExplanation(inv.extracted, inv.decision.trace?.find(step => step.rule === 'EXTRACTION'))[0]}</p>
      <p className="mt-2">{t('You can check the original and use “APPROVE INVOICE” to confirm your decision. If a detail is wrong, upload a corrected copy or ask me to check it again.')}</p>
    </InlineAlert>;
  }
  return (
    <InlineAlert tone="warn">
      <p>{t('This invoice needs corrections before approval.')}</p>
      {inv.decision?.explanation && <p className="mt-2">{inv.decision.explanation}</p>}
      <p className="mt-0.5">{t('Your current policy doesn’t let anyone approve it as-is. A policy change or corrected data is needed first.')}</p>
      <div className="my-3 flex flex-wrap gap-2">
        {inv.decision?.reasons.includes('UNKNOWN_VENDOR') && <Link to="/app" state={{ reviewInvoiceId: inv.id }} className={buttonClass('primary')}>{t('Resolve with Oli')}</Link>}
        <Link to="/app/rules" className={buttonClass('secondary')}>{t('Review rules and agreements')}</Link>
        <Link to="/app/bills" className={buttonClass('secondary')}>{t('Upload corrected invoice')}</Link>
      </div>
      {hints.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {[...new Set(hints)].map((h) => <li key={h}>{t(h)}</li>)}
        </ul>
      )}
    </InlineAlert>
  );
}

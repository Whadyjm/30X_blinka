import { useId, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { InvoiceDetail } from '@/contracts';
import { errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/Card';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useConfirmInvoiceReview } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { unverifiedExtractionFields } from '@/lib/extraction-explanation';

export function ManualInvoiceApproval({ invoice, policyVersionId, canDecide }: {
  invoice: InvoiceDetail; policyVersionId?: string; canDecide: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [comment, setComment] = useState('');
  const review = useConfirmInvoiceReview();
  const toast = useToast();
  const fields = invoice.extracted;
  const unverified = unverifiedExtractionFields(fields);
  const complete = fields && fields.vendorName && fields.amountMinor != null && fields.currency && fields.dueDate;
  const rows = [
    ['vendorName', 'Vendor', fields?.vendorName], ['invoiceNumber', 'Invoice number', fields?.invoiceNumber],
    ['amountMinor', 'Amount', fields?.amountMinor == null ? null : formatMoneyWithCode(fields.amountMinor, fields.currency)],
    ['currency', 'Currency', fields?.currency],
    ['dueDate', 'Due date', fields?.dueDate ? formatDate(fields.dueDate) : null],
    ['issuedAt', 'Issue date', fields?.issuedAt ? formatDate(fields.issuedAt) : null],
    ['servicePeriod', 'Service period', fields?.servicePeriod],
    ['description', 'Description', fields?.description],
  ];
  const open = () => { setConfirmed(false); setComment(''); review.reset(); dialog.current?.showModal(); };
  return <>
    <Button className="min-h-14 w-full text-base font-semibold" icon={<Check className="size-5" aria-hidden />}
      disabled={!canDecide || !invoice.decision?.id || !policyVersionId || review.isPending} onClick={open}>
      {t('APPROVE INVOICE')}
    </Button>
    {!canDecide && <p className="text-sm text-slate-600">{t('Only an owner or approver can confirm this invoice.')}</p>}
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-hairline bg-paper p-0 text-ink backdrop:bg-black/40">
      <form className="space-y-5 p-5 sm:p-6" onSubmit={async event => {
        event.preventDefault();
        if (!confirmed || !complete || !invoice.decision?.id || !policyVersionId || review.isPending) return;
        try {
          const result = await review.mutateAsync({ id: invoice.id, expectedDecisionId: invoice.decision.id, expectedPolicyVersionId: policyVersionId,
            confirm: true, comment: comment.trim() || t('I reviewed the original document, confirmed these details and requested approval.') });
          dialog.current?.close();
          if (result.decision?.decision === 'APPROVE') toast.success(t('Invoice approved.'));
          else toast.error(t('Your review was recorded. The invoice still needs attention: {reason}', { reason: result.decision?.explanation ?? '' }));
        } catch { /* The mutation error remains visible inside the dialog. */ }
      }}>
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold">{t('Do you want to approve this invoice?')}</h2>
          <Button variant="ghost" type="button" aria-label={t('Close')} onClick={() => dialog.current?.close()} icon={<X className="size-5" aria-hidden />} />
        </div>
        <p id={descriptionId} className="text-sm leading-relaxed text-slate-700">
          {t('I could not fully check this invoice. You can review its details and make the decision. If you confirm, I will record your approval after checking the spending rules.')}
        </p>
        <dl className="divide-y divide-hairline text-sm">
          {rows.map(([field, label, value]) => <div key={field} className="flex justify-between gap-4 py-2">
            <dt className="shrink-0 text-slate-600">{t(label!)}</dt>
            <dd className="min-w-0 break-words text-right">{value || t('Not found')}
              {value && unverified.has(field!) && <span className="block text-xs font-medium text-slate-700">{t('Not verified against the original')}</span>}
            </dd>
          </div>)}
        </dl>
        {unverified.has('currency') && <InlineAlert tone="warn">{t('The currency shown has not been verified. A symbol such as $ does not identify USD by itself. Confirm the currency with the issuer before approving.')}</InlineAlert>}
        <a href={invoice.fileUrl || `/api/v1/invoices/${encodeURIComponent(invoice.id)}/file`} target="_blank" rel="noopener noreferrer"
          className="inline-block text-sm underline underline-offset-4">{t('Open original')}</a>
        {!complete && <InlineAlert tone="warn">{t('Required details are missing. They need to be corrected before you can confirm approval.')}</InlineAlert>}
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-ink" checked={confirmed} disabled={!complete || review.isPending}
            onChange={event => setConfirmed(event.target.checked)} />
          {t('I checked these details against the original document and want to approve this invoice.')}
        </label>
        <TextAreaField label={t('Add a note (optional)')} value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} disabled={review.isPending} />
        {review.isError && <InlineAlert>{errorMessage(review.error)}</InlineAlert>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" className="min-h-12 flex-1" loading={review.isPending} disabled={!confirmed || !complete || review.isPending}>
            {t('Yes, approve invoice')}
          </Button>
          <Button type="button" variant="secondary" className="min-h-12" onClick={() => dialog.current?.close()}>{t('Keep in review')}</Button>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">{t('Your name and confirmation will be recorded. This authorizes the invoice; no money is sent.')}</p>
      </form>
    </dialog>
  </>;
}

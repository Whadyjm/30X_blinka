import { InlineAlert } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAiUsage } from '@/hooks/queries';
import { getLocale, t } from '@/i18n';

const labels = {
  INVOICE_EXTRACTION: 'Invoice reading', INVOICE_OCR: 'Image transcription (OCR)',
  PDF_CONVERSION: 'PDF conversion', CHAT: 'Conversations with Oli',
};

export function AiUsageSection({ orgId }: { orgId?: string }) {
  const usage = useAiUsage(!!orgId, orgId);
  const format = (value: number) => value.toLocaleString(getLocale());
  return (
    <section className="mb-8 max-w-2xl space-y-4 border-t border-hairline pt-6" aria-labelledby="ai-usage-heading">
      <div className="space-y-2">
        <h2 id="ai-usage-heading" className="text-xl">{t('AI usage')}</h2>
        <p className="text-sm text-slate-600">{t('Your company’s AI consumption, recorded on the server. Includes retries and every conversation round, across web and Telegram.')}</p>
      </div>
      {usage.isPending && <p role="status" className="text-sm text-slate-600">{t('Loading AI usage…')}</p>}
      {usage.isError && <InlineAlert tone="error">
        <p>{t('AI usage could not be loaded.')}</p>
        <Button variant="secondary" className="mt-2" onClick={() => void usage.refetch()} disabled={usage.isFetching}>{t('Try again')}</Button>
      </InlineAlert>}
      {usage.data && <>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <div><dt className="text-sm text-slate-600">{t('Reported tokens')}</dt><dd className="text-2xl font-semibold tabular-nums">{format(usage.data.totalTokens)}</dd></div>
          <div><dt className="text-sm text-slate-600">{t('AI calls')}</dt><dd className="text-2xl font-semibold tabular-nums">{format(usage.data.calls)}</dd></div>
        </dl>
        {usage.data.calls > 0 ? <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('AI usage by activity')}</caption>
            <thead><tr className="border-b border-hairline text-left text-slate-600">
              <th scope="col" className="py-3 pr-2 font-medium sm:pr-4">{t('Activity')}</th>
              {['Input', 'Output', 'Total', 'Calls'].map(label => <th key={label} scope="col" className={`py-3 pl-2 text-right font-medium sm:px-2 ${label === 'Calls' ? 'hidden sm:table-cell' : ''}`}>{t(label)}</th>)}
            </tr></thead>
            <tbody>{usage.data.breakdown.map(row => <tr key={row.category} className="border-b border-hairline">
              <th scope="row" className="py-3 pr-2 text-left font-normal sm:pr-4">{t(labels[row.category])}
                <span className="mt-1 block text-xs text-slate-600 sm:hidden">{t('{n} calls', { n: format(row.calls) })}</span>
              </th>
              {[row.inputTokens, row.outputTokens, row.totalTokens, row.calls].map((value, index) =>
                <td key={index} className={`py-3 pl-2 text-right tabular-nums sm:px-2 ${index === 3 ? 'hidden sm:table-cell' : ''}`}>{index < 3 && row.unreportedCalls === row.calls && row.calls > 0 && value === 0 ? '—' : format(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div> : <p className="text-sm text-slate-600">{t('No AI calls recorded yet.')}</p>}
        {usage.data.unreportedCalls > 0 && <InlineAlert tone="info">{t('{n} calls have incomplete token data. Reported totals are partial; missing usage is not counted as zero.', { n: format(usage.data.unreportedCalls) })}</InlineAlert>}
        <p className="text-sm text-slate-600">{t('Tracking starts when this feature is enabled. Earlier usage is not included. PDF conversion may not report tokens. Reusing a saved reading adds no AI usage.')}</p>
        {usage.data.firstCallAt && <p className="text-xs text-slate-500">{t('First recorded call: {date}', { date: new Date(usage.data.firstCallAt).toLocaleString(getLocale()) })}</p>}
      </>}
    </section>
  );
}

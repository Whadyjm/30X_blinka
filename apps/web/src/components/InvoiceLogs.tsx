import type { InvoiceDetail } from '@/contracts';
import { t } from '@/i18n';

export function InvoiceLogs({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <details id="invoice-logs" className="min-w-0 rounded-2xl border border-hairline bg-paper">
      <summary className="cursor-pointer rounded-2xl px-5 py-4 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        {t('Logs')} <span className="ml-2 text-slate-600">{t('Technical details')}</span>
      </summary>
      <div className="space-y-5 border-t border-hairline p-5">
        <p className="text-sm text-slate-600">{t('Reading notes, document quotes and recorded decision details.')}</p>
        {[
          ['Document reading', invoice.extracted],
          ['Decision', invoice.decision],
          ['Earlier decisions', invoice.decisionHistory],
          ['Audit log', invoice.audit],
        ].map(([label, data]) => (
          <section key={String(label)}>
            <h3 className="mb-2 text-sm text-ink">{t(String(label))}</h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bone p-3 font-mono text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{JSON.stringify(data ?? null, null, 2)}</pre>
          </section>
        ))}
      </div>
    </details>
  );
}

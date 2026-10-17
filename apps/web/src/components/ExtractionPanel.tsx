import { AlertTriangle, HelpCircle } from 'lucide-react';
import type { ExtractedInvoice } from '@/contracts';
import { t } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { formatMoneyWithCode } from '@/lib/money';
import { cn } from '@/lib/cn';

/** Extracted fields. Anything the reader couldn't verify is highlighted instead of silently blank (§4.4). */
export function ExtractionPanel({ extracted, pending }: { extracted: ExtractedInvoice | null | undefined; pending?: boolean }) {
  if (!extracted) {
    return <p className="px-5 py-4 text-sm text-slate-500">{pending ? t('Reading the document…') : t('No data was extracted from this document.')}</p>;
  }
  // [label (English i18n key), value, required]
  const rows: Array<[string, string | null, boolean]> = [
    ['Vendor', extracted.vendorName, true],
    ['Invoice number', extracted.invoiceNumber, false],
    ['Amount', extracted.amountMinor == null ? null : formatMoneyWithCode(extracted.amountMinor, extracted.currency), true],
    ['Currency', extracted.currency, true],
    ['Issued', extracted.issuedAt ? formatDate(extracted.issuedAt) : null, false],
    ['Due', extracted.dueDate ? formatDate(extracted.dueDate) : null, true],
    ['Description', extracted.description, false],
  ];
  return (
    <div>
      <dl className="divide-y divide-hairline">
        {rows.map(([label, value, required]) => {
          const missing = value == null || value === '';
          return (
            <div key={label} className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm">
              <dt className="shrink-0 text-slate-500">{t(label)}</dt>
              <dd className={cn('min-w-0 break-words text-right', missing ? (required ? 'text-ink underline decoration-dotted underline-offset-4' : 'text-slate-400') : 'text-ink')}>
                {missing ? (
                  required ? (
                    <span className="inline-flex items-center gap-1">
                      <HelpCircle className="size-3.5" aria-hidden /> {t('Couldn’t verify')}
                    </span>
                  ) : (
                    t('Not found')
                  )
                ) : (
                  value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {extracted.extractionWarnings.length > 0 && (
        <ul className="m-4 space-y-1 rounded-xl bg-white p-3 text-sm text-ink ring-1 ring-inset ring-ink">
          {extracted.extractionWarnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      {extracted.evidence.length > 0 && (
        <details className="border-t border-hairline px-5 py-3 text-sm">
          <summary className="text-slate-600">{t('Evidence from the document ({n})', { n: extracted.evidence.length })}</summary>
          <ul className="mt-2 space-y-1.5">
            {extracted.evidence.map((e, i) => (
              <li key={i} className="text-slate-600">
                <span className="text-ink">{e.field}</span> · {e.source}
                {e.quote && <span className="block italic">“{e.quote}”</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

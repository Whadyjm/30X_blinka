import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from 'lucide-react';
import { OutcomeBadge } from '@/components/Badges';
import { Button } from '@/components/ui/Button';
import { env, UPLOAD } from '@/config/env';
import type { InvoiceSummary } from '@/contracts';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { getOutcome, processingLabel } from '@/lib/outcome';
import { useUploadQueue, type UploadItem } from './useUploadQueue';

const MOCK_KEYWORDS = ['ok', 'over-limit', 'contract-mismatch', 'duplicate', 'unknown-vendor', 'hard-limit', 'injection', 'unreadable'];

export function UploadZone({ invoices }: { invoices: InvoiceSummary[] }) {
  const { items, add, clearFinished } = useUploadQueue();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add([...e.dataTransfer.files]);
  };

  return (
    <section aria-label={t('Upload invoices')}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-8 text-center transition-colors',
          over ? 'border-ink bg-white' : 'border-smoke',
        )}
      >
        <div className="grid size-12 place-items-center rounded-xl bg-bone text-ink">
          <FileUp className="size-6" aria-hidden />
        </div>
        <div>
          <p className="text-ink">{t('Drop invoices here')}</p>
          <p className="text-sm text-slate-500">{t('PDF, PNG or JPEG · up to 5 MB each · several at once is fine')}</p>
        </div>
        <Button onClick={() => input.current?.click()}>{t('Choose files')}</Button>
        <input ref={input} type="file" multiple accept={UPLOAD.accept} className="sr-only" aria-label={t('Choose invoice files')} onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <p className="text-xs text-slate-400">{t('Synthetic documents only. Nothing here moves real money.')}</p>
        {env.apiMode === 'mock' && (
          <p className="max-w-xl rounded-md bg-bone px-3 py-2 text-xs text-slate-500">
            {t('Mock mode: the outcome follows the file name. Try one of these words in the name:')}{' '}
            {MOCK_KEYWORDS.map((k, i) => (
              <span key={k}>
                <code>{k}</code>
                {i < MOCK_KEYWORDS.length - 1 ? ', ' : '. '}
              </span>
            ))}
            {t('Uploading the same file twice triggers the duplicate rule.')}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-4 rounded-2xl border border-hairline bg-white" aria-live="polite">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <h2 className="text-sm text-ink">{t('This batch')}</h2>
            <button type="button" onClick={clearFinished} className="text-xs text-slate-500 hover:text-ink">
              {t('Clear finished')}
            </button>
          </div>
          <ul className="divide-y divide-hairline">
            {items.map((it) => (
              <Row key={it.key} item={it} invoice={invoices.find((i) => i.id === it.invoiceId)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ item, invoice }: { item: UploadItem; invoice?: InvoiceSummary }) {
  let status: ReactNode;
  if (item.phase === 'error') {
    status = (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink">
        <AlertCircle className="size-4" aria-hidden /> {item.error}
      </span>
    );
  } else if (item.phase === 'queued') {
    status = <span className="text-sm text-slate-500">{t('Waiting…')}</span>;
  } else if (item.phase === 'uploading') {
    status = (
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('Uploading…')}
      </span>
    );
  } else if (invoice) {
    const o = getOutcome(invoice);
    status =
      o === 'PROCESSING' ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {processingLabel(invoice.status)}
        </span>
      ) : (
        <OutcomeBadge outcome={o} />
      );
  } else {
    status = (
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
        <CheckCircle2 className="size-4 text-ink" aria-hidden /> {t('Received')}
      </span>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        {item.invoiceId ? (
          <Link to={`/app/bills/${item.invoiceId}`} className="block truncate text-sm text-ink underline-offset-2 hover:underline">
            {item.name}
          </Link>
        ) : (
          <span className="block truncate text-sm text-ink">{item.name}</span>
        )}
        <span className="text-xs text-slate-400">{(item.size / 1024).toFixed(0)} KB</span>
        {item.phase === 'submitted' && item.error && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-ink">
            <X className="size-3" aria-hidden /> {item.error}
          </span>
        )}
      </div>
      {status}
    </li>
  );
}

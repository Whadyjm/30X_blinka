import { useEffect, useState } from 'react';
import { ExternalLink, FileX2 } from 'lucide-react';
import { api } from '@/api';
import type { InvoiceDetail } from '@/contracts';
import { t } from '@/i18n';
import { UPLOAD } from '@/config/env';

/** Original document next to the extracted data. Same-origin, cookie-authenticated, never public. */
export function DocumentViewer({ invoice }: { invoice: InvoiceDetail }) {
  const [failed, setFailed] = useState(false);
  const url = api.invoiceFileUrl(invoice);
  const isPdf = invoice.mimeType === 'application/pdf' || invoice.fileName?.toLowerCase().endsWith('.pdf');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    setFailed(false); setPreview(null);
    if (!isPdf || !url) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    // The private download remains sandboxed. A bounded, ephemeral PDF Blob lets the
    // browser's own viewer render it without inheriting that download's CSP sandbox.
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!response.ok || !response.body || response.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf') throw new Error('PDF_UNAVAILABLE');
        const reader = response.body.getReader(); const chunks: BlobPart[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > UPLOAD.maxBytes) { await reader.cancel(); throw new Error('PDF_TOO_LARGE'); }
            chunks.push(new Uint8Array(value));
          }
        } finally { reader.releaseLock(); }
        if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' })); setPreview(objectUrl); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, isPdf]);
  const alt = t('Invoice document {name}', { name: invoice.fileName ?? '' });

  if (!url || failed) {
    return (
      <div className="grid min-h-64 place-items-center rounded-lg bg-slate-50 p-6 text-center">
        <div>
          <FileX2 className="mx-auto size-8 text-slate-400" aria-hidden />
          <p className="mt-2 text-sm text-slate-700">{t('Document preview unavailable')}</p>
          <p className="mt-1 text-xs text-slate-500">{failed ? t('The file could not be loaded.') : t('This record has no stored file.')}</p>
          {url && <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-ink underline">{t('Open original')}</a>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
        {isPdf ? (preview ? (
          <object data={preview} type="application/pdf" className="h-[32rem] w-full" aria-label={alt} onError={() => setFailed(true)}>
            <div className="p-6 text-center text-sm text-slate-600">
              {t('Your browser can’t display this PDF inline.')}{' '}
              <a href={url} target="_blank" rel="noreferrer" className="text-ink underline">
                {t('Open it in a new tab')}
              </a>
              .
            </div>
          </object>
        ) : <p className="p-6 text-sm text-slate-600" role="status">{t('Loading original document…')}</p>) : (
          <img src={url} alt={alt} className="max-h-[32rem] w-full object-contain" onError={() => setFailed(true)} />
        )}
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-ink underline underline-offset-2">
        <ExternalLink className="size-3" aria-hidden /> {t('Open original')}
      </a>
    </div>
  );
}

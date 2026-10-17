import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api';
import { UPLOAD } from '@/config/env';
import { qk } from '@/hooks/queries';
import { t } from '@/i18n';

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  phase: 'queued' | 'uploading' | 'submitted' | 'error';
  invoiceId?: string;
  error?: string;
};

const CONCURRENCY = 2;
let counter = 0;

export function validateFile(f: File): string | null {
  if (!UPLOAD.mimeTypes.includes(f.type)) return t('Only PDF, PNG or JPEG files are accepted.');
  if (f.size === 0) return t('This file is empty.');
  if (f.size > UPLOAD.maxBytes) return t('Too large ({mb} MB). The limit is 5 MB.', { mb: (f.size / 1024 / 1024).toFixed(1) });
  return null;
}

/**
 * Batch upload: POST /invoices → POST /invoices/:id/process (idempotent) → the invoices list polls
 * until the server reports a decision. The UI never decides anything; it only forwards files.
 */
export function useUploadQueue() {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const pending = useRef<Array<{ key: string; file: File }>>([]);
  const active = useRef(0);

  const patch = useCallback((key: string, p: Partial<UploadItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))), []);

  const pump = useCallback(async () => {
    while (active.current < CONCURRENCY && pending.current.length > 0) {
      const job = pending.current.shift()!;
      active.current++;
      patch(job.key, { phase: 'uploading' });
      void (async () => {
        try {
          const inv = await api.uploadInvoice(job.file);
          patch(job.key, { phase: 'submitted', invoiceId: inv.id });
          // Make the row appear (and start polling) immediately, then ask the server to evaluate.
          void qc.invalidateQueries({ queryKey: qk.invoices });
          try {
            await api.processInvoice(inv.id);
          } catch (e) {
            // The invoice exists; surface the problem but keep the link.
            patch(job.key, { error: errorMessage(e) });
          }
        } catch (e) {
          patch(job.key, { phase: 'error', error: errorMessage(e) });
        } finally {
          active.current--;
          void qc.invalidateQueries({ queryKey: qk.invoices });
          void qc.invalidateQueries({ queryKey: qk.approvals });
          void pump();
        }
      })();
    }
  }, [patch, qc]);

  const add = useCallback(
    (files: File[]) => {
      const fresh: UploadItem[] = [];
      for (const file of files) {
        const key = `u${++counter}`;
        const err = validateFile(file);
        fresh.push({ key, name: file.name, size: file.size, phase: err ? 'error' : 'queued', error: err ?? undefined });
        if (!err) pending.current.push({ key, file });
      }
      setItems((xs) => [...fresh, ...xs]);
      void pump();
    },
    [pump],
  );

  const clearFinished = useCallback(() => setItems((xs) => xs.filter((x) => x.phase === 'queued' || x.phase === 'uploading')), []);

  return { items, add, clearFinished };
}

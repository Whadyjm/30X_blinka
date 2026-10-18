import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/Card';
import { UploadZone } from '@/features/invoices/UploadZone';
import { InvoiceList } from '@/features/invoices/InvoiceList';
import { InvoiceTrashButton } from '@/features/invoices/InvoiceTrashButton';
import { InvoiceTrashHistory } from '@/features/invoices/InvoiceTrashHistory';
import { invoiceTrashState } from '@/lib/invoice-trash';
import { useInvoices, useInvoiceTrash, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { getOutcome, outcomeLabel, type Outcome } from '@/lib/outcome';

// English source labels (i18n keys) — translated at render time.
const FILTERS: Array<{ key: 'ALL' | 'DELETED' | Outcome; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'NEEDS_APPROVAL', label: 'Needs approval' },
  { key: 'NEEDS_REVIEW', label: 'Needs review' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'DELETED', label: 'Deleted invoices' },
];

export function Bills() {
  const [params, setParams] = useSearchParams();
  const outcome = (params.get('outcome') ?? 'ALL') as 'ALL' | 'DELETED' | Outcome;
  const q = params.get('q') ?? '';
  const invoices = useInvoices(true);
  const trash = useInvoiceTrash(), me = useMe();
  const latest = invoiceTrashState(trash.data ?? []);
  const deleted = outcome === 'DELETED';

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'ALL') next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const all = invoices.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((i) => {
    const o = getOutcome(i);
    if (Boolean(latest.get(i.id)?.trashed) !== deleted) return false;
    if (outcome !== 'ALL' && outcome !== 'DELETED' && o !== outcome) return false;
    if (!needle) return true;
    return [i.vendorName, i.invoiceNumber, i.fileName, i.requestingAgentName].some((s) => s?.toLowerCase().includes(needle));
  });
  const count = (k: 'ALL' | 'DELETED' | Outcome) => all.filter(i => k === 'DELETED' ? latest.get(i.id)?.trashed : !latest.get(i.id)?.trashed && (k === 'ALL' || getOutcome(i) === k)).length;

  const emptyBody =
    deleted ? t('Deleted invoices appear here. You can restore them at any time.') : all.length === 0
      ? t('Drop a PDF or image above to get started.')
      : outcome === 'ALL'
        ? t('No invoices match your search.')
        : t('No {status} invoices match your search.', { status: outcomeLabel(outcome).toLowerCase() });

  return (
    <>
      <PageHeader title={t('Bills')} subtitle={t('Upload invoices and see what Oli decided — and why.')}
        actions={<Button variant="secondary" onClick={() => void invoices.refresh()} loading={invoices.isFetching}>{t('Refresh')}</Button>} />
      <p className="mb-4 text-sm text-ash">{t('Approved means authorized by Oli. No payment has been recorded or sent.')}</p>
      {!deleted && <UploadZone invoices={all} />}
      <details className="mt-4 text-sm leading-relaxed text-slate-600"><summary className="min-h-11 cursor-pointer">{t('What is kept when I delete an invoice?')}</summary><p className="mt-1 max-w-prose">{t('Moving an invoice to Deleted hides it from the active list. Its document and decisions are kept. Processing continues and authorizations or budget reservations are not cancelled.')}</p></details>

      <Card className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div role="tablist" aria-label={t('Filter by status')} className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={outcome === f.key}
                type="button"
                onClick={() => set('outcome', f.key)}
                className={cn('rounded-md px-3 py-1 text-sm', outcome === f.key ? 'bg-highlighter text-on-accent' : 'text-slate-600 hover:bg-bone')}
              >
                {t(f.label)} <span className={cn('ml-0.5 text-xs', outcome === f.key ? 'text-ink/60' : 'text-slate-400')}>{count(f.key)}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              aria-label={t('Search invoices')}
              placeholder={t('Search vendor, number, file…')}
              value={q}
              onChange={(e) => set('q', e.target.value)}
              className="w-full rounded-[10px] border-0 bg-paper py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-field-border focus:ring-2 focus:ring-ink"
            />
          </div>
        </div>

        {invoices.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState title={deleted ? t('No deleted invoices') : all.length === 0 ? t('No invoices yet') : t('Nothing matches')} body={emptyBody} />
        ) : (
          <InvoiceList invoices={shown} actions={me.data?.role === 'owner' ? invoice => <InvoiceTrashButton invoiceId={invoice.id} title={invoice.vendorName ?? invoice.fileName ?? invoice.id} compact /> : undefined} />
        )}
      </Card>
      {deleted && <div className="mt-5"><InvoiceTrashHistory /></div>}
    </>
  );
}

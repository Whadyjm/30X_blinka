import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/Card';
import { UploadZone } from '@/features/invoices/UploadZone';
import { InvoiceList } from '@/features/invoices/InvoiceList';
import { useInvoices } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { getOutcome, outcomeLabel, type Outcome } from '@/lib/outcome';

// English source labels (i18n keys) — translated at render time.
const FILTERS: Array<{ key: 'ALL' | Outcome; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'NEEDS_APPROVAL', label: 'Needs approval' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'PROCESSING', label: 'Processing' },
];

export function Bills() {
  const [params, setParams] = useSearchParams();
  const outcome = (params.get('outcome') ?? 'ALL') as 'ALL' | Outcome;
  const q = params.get('q') ?? '';
  const invoices = useInvoices();

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
    if (outcome !== 'ALL' && o !== outcome) return false;
    if (!needle) return true;
    return [i.vendorName, i.invoiceNumber, i.fileName, i.requestingAgentName].some((s) => s?.toLowerCase().includes(needle));
  });
  const count = (k: 'ALL' | Outcome) => (k === 'ALL' ? all.length : all.filter((i) => getOutcome(i) === k).length);

  const emptyBody =
    all.length === 0
      ? t('Drop a PDF or image above to get started.')
      : outcome === 'ALL'
        ? t('No invoices match your search.')
        : t('No {status} invoices match your search.', { status: outcomeLabel(outcome).toLowerCase() });

  return (
    <>
      <PageHeader title={t('Bills')} subtitle={t('Upload invoices and see what Oli decided — and why.')} />
      <UploadZone invoices={all} />

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
                className={cn('rounded-md px-3 py-1 text-sm', outcome === f.key ? 'bg-highlighter text-ink' : 'text-slate-600 hover:bg-bone')}
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
              className="w-full rounded-[10px] border-0 bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-[rgba(33,33,33,0.15)] focus:ring-2 focus:ring-ink"
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
          <EmptyState title={all.length === 0 ? t('No invoices yet') : t('Nothing matches')} body={emptyBody} />
        ) : (
          <InvoiceList invoices={shown} />
        )}
      </Card>
    </>
  );
}

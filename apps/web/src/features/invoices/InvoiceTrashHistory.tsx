import { Link } from 'react-router';
import { useInvoiceTrash } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';

export function InvoiceTrashHistory({ invoiceId }: { invoiceId?: string }) {
  const history = useInvoiceTrash();
  const events = (history.data ?? []).filter(event => !invoiceId || event.invoiceId === invoiceId);
  if (!events.length) return null;
  return <details className="rounded-xl border border-hairline bg-white p-5">
    <summary className="min-h-11 cursor-pointer text-sm text-ink">{t('Deletion and restore history')}</summary>
    <p className="mb-3 text-xs text-ash">{t('The latest 20 movements. Earlier entries remain on record.')}</p>
    <ul className="divide-y divide-hairline">{events.slice(0, 20).map(event => <li key={event.id} className="space-y-1 py-3 text-sm [overflow-wrap:anywhere]">
      <p>{t(event.trashed ? 'Moved to Deleted' : 'Restored')} · <Link to={`/app/bills/${encodeURIComponent(event.invoiceId)}`} className="underline underline-offset-4">{event.invoiceName}</Link></p>
      <p className="text-xs text-ash">{formatDateTime(event.at)} · {event.userName ?? event.userId}</p>
    </li>)}</ul>
  </details>;
}

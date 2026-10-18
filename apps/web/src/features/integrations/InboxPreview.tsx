import { Link } from 'react-router';
import { Mail } from 'lucide-react';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/Card';
import { useInbox } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';

export function InboxPreview() {
  const query = useInbox();
  return <Card>
    <CardHeader title={t('Inbox')} action={<Link to="/app/inbox" className="text-sm text-ink underline underline-offset-2">{t('View all')}</Link>} />
    {query.isLoading ? <div className="p-5"><Skeleton className="h-16" /></div> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      : !query.data?.messages.length ? <div className="p-5 text-sm text-slate-600"><Mail className="mb-3 size-5" aria-hidden /><p>{t('Invoices sent to Oli’s email will appear here.')}</p><Link to="/app/integrations?channel=email" className="mt-3 inline-block text-ink underline underline-offset-4">{t('Get Oli’s address')}</Link></div>
        : <ul className="divide-y divide-hairline">{query.data.messages.slice(0, 3).map(message => <li key={message.id}>
          <Link to="/app/inbox" className="block px-5 py-4 hover:bg-bone">
            <div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-medium text-ink">{message.subject}</p>{!message.readAt && <span className="shrink-0 rounded-md bg-highlighter px-2 py-0.5 text-xs text-on-accent">{t('New')}</span>}</div>
            <p className="mt-1 truncate text-xs text-slate-600">{message.sender} · {formatDateTime(message.receivedAt)}</p>
            <p className="mt-2 text-sm text-slate-600">{message.summary}</p>
          </Link>
        </li>)}</ul>}
  </Card>;
}

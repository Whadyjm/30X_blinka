import { Link } from 'react-router';
import { Check, FileText, Mail, RefreshCw } from 'lucide-react';
import { errorMessage } from '@/api';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, InlineAlert, PageHeader, Skeleton } from '@/components/ui/Card';
import { useInbox, useReadInboxMessage } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';

export function Inbox() {
  const query = useInbox(), read = useReadInboxMessage();
  return <>
    <PageHeader title={t('Inbox')} subtitle={t('What arrived for Oli, and what happened next.')} actions={<>
      <Button variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()} icon={<RefreshCw className="size-4" aria-hidden />}>{t('Refresh')}</Button>
      <Link to="/app/integrations" className={buttonClass('secondary')}>{t('Oli’s email')}</Link>
    </>} />
    <p role="status" className="mb-4 text-xs text-ash">{t(query.isError ? 'Could not check for new email. Retrying automatically.' : 'Checking for new email every 5 seconds while the app is open.')}</p>
    {read.isError && <div className="mb-4"><InlineAlert>{errorMessage(read.error)}</InlineAlert></div>}
    {query.isLoading ? <Skeleton className="h-60" /> : query.isError ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>
      : !query.data?.messages.length ? <Card><EmptyState icon={<Mail className="size-6" aria-hidden />} title={t('Ready for your first email')}
        body={t('Share Oli’s address with a supplier. Their documents will appear here as soon as the email arrives.')}
        action={<Link to="/app/integrations" className={buttonClass()}>{t('Get Oli’s address')}</Link>} /></Card>
        : <Card><ul className="divide-y divide-hairline">
          {query.data.messages.map(message => <li key={message.id} className={`p-5 sm:p-6 ${!message.readAt ? 'bg-bone/40' : ''}`}>
            <article>
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 break-words text-base font-semibold text-ink">{message.subject}</h2>
                    {!message.readAt && <span className="rounded-md bg-highlighter px-2 py-0.5 text-xs text-ink">{t('New')}</span>}
                  </div>
                  <p className="mt-1 break-all text-sm text-slate-600">{message.sender}</p>
                  <time dateTime={message.receivedAt} className="mt-1 block text-xs text-slate-500">{formatDateTime(message.receivedAt)}</time>
                </div>
                {!message.readAt && <Button variant="ghost" size="sm" loading={read.isPending && read.variables === message.id} onClick={() => read.mutate(message.id)} icon={<Check className="size-4" aria-hidden />}>{t('Mark as read')}</Button>}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{message.summary}</p>
              {!!message.attachments.length && <ul className="mt-4 space-y-3">
                {message.attachments.map(a => <li key={a.id} className="flex gap-3">
                  <FileText className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    {a.invoiceId ? <Link to={`/app/bills/${encodeURIComponent(a.invoiceId)}`} onClick={() => { if (!message.readAt) read.mutate(message.id); }} className="break-words text-sm text-ink underline underline-offset-4">{a.name}</Link> : <p className="break-words text-sm text-ink">{a.name}</p>}
                    <p className="mt-1 text-xs text-slate-600">{t(a.decision === 'APPROVE' ? 'Approved' : a.decision === 'BLOCK' ? 'Blocked by your rules' : a.decision === 'ESCALATE' ? 'Needs review' : a.status === 'FAILED' || message.state === 'FAILED' ? 'Could not read the document' : 'Reviewing document')}</p>
                    {a.explanation && <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-600">{a.explanation}</p>}
                  </div>
                </li>)}
              </ul>}
            </article>
          </li>)}
        </ul></Card>}
    {query.data?.messages.length === 50 && <p className="mt-4 text-xs text-slate-500">{t('Showing the latest 50 messages.')}</p>}
  </>;
}

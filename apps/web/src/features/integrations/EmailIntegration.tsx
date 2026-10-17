import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Mail } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { Card, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Card';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';

export function EmailIntegration() {
  const me = useMe(), qc = useQueryClient();
  const key = ['integrations', 'email', me.data?.org?.id];
  const query = useQuery({ queryKey: key, queryFn: () => api.getEmailIntegration(), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const mailbox = query.data?.mailbox;
  const enable = useMutation({ mutationFn: () => api.enableEmail(), onSuccess: value => { qc.setQueryData(key, value); setError(null); }, onError: e => setError(errorMessage(e)) });
  const disable = useMutation({ mutationFn: () => api.disableEmail(), onSuccess: () => { setError(null); setConfirmDisable(false); void query.refetch(); }, onError: e => setError(errorMessage(e)) });
  const copy = async () => {
    if (!mailbox) return;
    try { await navigator.clipboard.writeText(mailbox.address); setCopied(true); }
    catch { setError(t('Could not copy the address. Select it and copy it manually.')); }
  };
  return <Card className="mb-6 p-5 sm:p-8">
    <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
      <section aria-labelledby="email-title">
        <Mail className="mb-4 size-8 text-ink" strokeWidth={1.5} aria-hidden />
        <h2 id="email-title" className="text-xl text-ink">{t('Oli’s email')}</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">{t('Give this address to your suppliers. Oli will review their invoices and notify you here and on Telegram.')}</p>
        {query.isLoading ? <Skeleton className="mt-5 h-12" /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <div className="mt-5 space-y-4">
          {mailbox && <div>
            <label htmlFor="oli-email-address" className="mb-2 block text-sm text-ink">{t('Your company’s address')}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="oli-email-address" value={mailbox.address} readOnly onFocus={e => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-hairline bg-bone px-3 py-2.5 text-sm text-ink" />
              <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>{copied ? t('Copied') : t('Copy address')}</Button>
            </div>
            <p role="status" className="mt-2 text-xs text-slate-600">{mailbox.enabled ? t('Receiving invoices') : t('Email reception paused')}</p>
          </div>}
          {!query.data?.available ? <p className="text-sm text-slate-600">{t('Email is temporarily unavailable.')}</p>
            : !mailbox?.enabled ? <Button loading={enable.isPending} disabled={me.data?.role !== 'owner'} onClick={() => enable.mutate()}>{mailbox ? t('Resume email reception') : t('Create Oli’s address')}</Button>
              : me.data?.role === 'owner' && (confirmDisable ? <div className="space-y-3">
                <p className="text-sm text-slate-600">{t('New emails to this address will be rejected. Existing messages and invoices stay in Oli.')}</p>
                <div className="flex flex-wrap gap-2"><Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>{t('Pause reception')}</Button><Button variant="ghost" disabled={disable.isPending} onClick={() => setConfirmDisable(false)}>{t('Keep receiving')}</Button></div>
              </div> : <Button variant="ghost" size="sm" onClick={() => setConfirmDisable(true)}>{t('Pause reception')}</Button>)}
          {me.data?.role !== 'owner' && !mailbox?.enabled && <p className="text-sm text-slate-600">{t('Ask an owner to enable email for this company.')}</p>}
          {error && <InlineAlert>{error}</InlineAlert>}
        </div>}
      </section>
      <div className="border-t border-hairline pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h3 className="text-base text-ink">{t('Send it to my assistant')}</h3>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">{t('Suppliers can attach PDFs, JPGs or PNGs. Send up to four documents, 5 MB each and 8 MB in total.')}</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">{t('Oli records what arrived, checks your rules and keeps the explanation with every document.')}</p>
        <Link to="/app/inbox" className="mt-5 inline-block text-sm text-ink underline underline-offset-4">{t('Open inbox')}</Link>
      </div>
    </div>
  </Card>;
}

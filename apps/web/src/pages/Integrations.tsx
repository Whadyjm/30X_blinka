import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, Send, Unplug } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { TelegramLink } from '@oli/contracts';
import { api, ApiError, errorMessage } from '@/api';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card, ErrorState, InlineAlert, PageHeader, Skeleton } from '@/components/ui/Card';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { EmailIntegration } from '@/features/integrations/EmailIntegration';
import { SkillIntegration } from '@/features/integrations/SkillIntegration';

export function Integrations() {
  const me = useMe();
  const qc = useQueryClient();
  const queryKey = ['integrations', 'telegram', me.data?.org?.id, me.data?.user.id];
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validLink = link !== null && new Date(link.expiresAt).getTime() > clock;
  const status = useQuery({ queryKey, queryFn: () => api.getTelegramIntegration(), retry: false,
    refetchInterval: validLink ? 2500 : false, refetchOnWindowFocus: 'always' });
  const connection = status.data?.connection;
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [link]);
  useEffect(() => { if (connection) setLink(null); }, [connection]);
  const connect = useMutation({ mutationFn: () => api.createTelegramLink(),
    onMutate: () => setError(null),
    onSuccess: value => { setClock(Date.now()); setLink(value); },
    onError: e => {
      const configurationError = e instanceof ApiError && ['TELEGRAM_BOT_TOKEN_INVALID', 'TELEGRAM_WEBHOOK_SECRET_INVALID', 'TELEGRAM_WEBHOOK_REJECTED'].includes(e.code);
      setError(configurationError ? t('The Telegram connection needs attention. Please try later or contact your administrator.') : errorMessage(e));
      void qc.invalidateQueries({ queryKey });
    } });
  const disconnect = useMutation({ mutationFn: () => api.disconnectTelegram(),
    onMutate: () => setError(null),
    onSuccess: () => { setLink(null); setConfirmDisconnect(false); void qc.invalidateQueries({ queryKey }); },
    onError: e => setError(errorMessage(e)) });

  return <>
    <PageHeader title={t('Integrations')} subtitle={t('Connect the places where your invoices arrive.')} />
    <EmailIntegration />
    <SkillIntegration />
    {status.isLoading ? <Skeleton className="h-72" />
      : status.isError ? <Card><ErrorState error={status.error} onRetry={() => void status.refetch()} /></Card>
      : <Card>
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
          <section aria-labelledby="telegram-title">
            <div className="mb-6 flex items-center justify-between gap-4">
              <Send className="size-8 text-ink" strokeWidth={1.5} aria-hidden />
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${connection ? 'bg-highlighter text-ink' : 'bg-bone text-slate-600'}`}>
                {connection && <Check className="size-3.5" aria-hidden />}
                {connection ? t('Connected') : t('Not connected')}
              </span>
            </div>
            <h2 id="telegram-title" className="text-xl text-ink">Telegram</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              {t('Send a PDF or photo to Oli. Get its decision and the explanation back in your chat.')}
            </p>
            <div className="mt-5 border-t border-hairline pt-4 text-sm">
              <p className="text-ash">{t('Company')}</p>
              <p className="mt-1 break-words text-ink">{me.data?.org?.name}</p>
              {connection && <div className="mt-4">
                <p className="break-words text-ink">{t('Linked as {name}', { name: connection.displayName })}</p>
                <p className="mt-1 text-xs text-ash">{t('Connected on {date}', { date: formatDateTime(connection.connectedAt) })}</p>
              </div>}
            </div>
            <div className="mt-6 space-y-4">
              {!status.data?.available && <InlineAlert tone="info">{t('Telegram is temporarily unavailable. Please try again later.')}</InlineAlert>}
              {error && <InlineAlert>{error}</InlineAlert>}
              {connection ? confirmDisconnect ? <div className="space-y-3">
                <p className="text-sm text-slate-700">{t('New invoices from this Telegram account will stop arriving in Oli. Your existing invoices will stay here.')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>{t('Disconnect Telegram')}</Button>
                  <Button variant="ghost" disabled={disconnect.isPending} onClick={() => setConfirmDisconnect(false)}>{t('Cancel')}</Button>
                </div>
              </div> : <Button variant="secondary" icon={<Unplug className="size-4" aria-hidden />} onClick={() => setConfirmDisconnect(true)}>{t('Disconnect Telegram')}</Button>
                : validLink && link ? <div className="space-y-3">
                  <figure className="w-fit max-w-full">
                    <QRCodeSVG value={link.url} size={224} level="M" marginSize={4}
                      title={t('QR code to connect your Telegram account')} role="img"
                      className="block h-auto max-w-full" aria-describedby="telegram-qr-instructions" />
                    <figcaption id="telegram-qr-instructions" className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
                      {t('Scan with your phone’s camera, then tap Start in Telegram.')}
                    </figcaption>
                  </figure>
                  <a className={buttonClass()} href={link.url} target="_blank" rel="noreferrer">
                    {t('Open Telegram')} <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                  <p role="status" className="max-w-sm text-sm leading-relaxed text-slate-600">{t('Tap Start in Telegram. This page will update when your account is connected.')}</p>
                  <p className="text-xs text-ash">{t('Link expires in {minutes}:{seconds}', {
                    minutes: Math.floor(Math.max(0, new Date(link.expiresAt).getTime() - clock) / 60000),
                    seconds: String(Math.floor(Math.max(0, new Date(link.expiresAt).getTime() - clock) / 1000) % 60).padStart(2, '0'),
                  })}</p>
                </div> : <div className="space-y-3">
                  {link && <p className="text-sm text-slate-600" role="status">{t('Your link expired. Generate a new one to continue.')}</p>}
                  <Button disabled={!status.data?.available} loading={connect.isPending} onClick={() => connect.mutate()} icon={<Send className="size-4" aria-hidden />}>
                    {t(link ? 'Generate a new link' : 'Connect Telegram')}
                  </Button>
                </div>}
            </div>
          </section>
          <section aria-labelledby="telegram-how" className="border-t border-hairline pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <h3 id="telegram-how" className="text-base text-ink">{t(connection ? 'Ready for your next invoice' : 'From your chat to Oli')}</h3>
            <ol className="mt-5 space-y-6 text-sm">
              {([
                ['Link your account', 'Open Telegram and tap Start to connect it to this company.'],
                ['Send an invoice', 'Attach a PDF, JPG or PNG up to 5 MB in your private chat with the bot.'],
                ['Get the explanation', 'Oli checks your rules and replies with the result and a link to the invoice.'],
              ] as const).map(([title, detail], index) => <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-bone text-xs text-ink">{index + 1}</span>
                <div><p className="text-ink">{t(title)}</p><p className="mt-1 max-w-sm leading-relaxed text-slate-600">{t(detail)}</p></div>
              </li>)}
            </ol>
            <p className="mt-8 border-t border-hairline pt-4 text-xs leading-relaxed text-ash">{t('Your company’s rules apply to every invoice, wherever it arrives.')}</p>
          </section>
        </div>
      </Card>}
  </>;
}

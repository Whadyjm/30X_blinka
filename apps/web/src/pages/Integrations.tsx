import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Bot, Mail, Send } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui/Card';
import { EmailIntegration } from '@/features/integrations/EmailIntegration';
import { SkillIntegration } from '@/features/integrations/SkillIntegration';
import { TelegramIntegration } from '@/features/integrations/TelegramIntegration';
import { t } from '@/i18n';

const channels = [
  { id: 'telegram', title: 'Telegram', icon: Send,
    description: 'Send a PDF or photo to Oli. Get its decision and the explanation back in your chat.' },
  { id: 'skill', title: 'OliSkill for agents', icon: Bot,
    description: 'Connect your AI agent to send invoices and read Oli’s decisions.',
    detail: 'Hermes · OpenClaw · Grokbot' },
  { id: 'email', title: 'OLI email', icon: Mail,
    description: 'Get an email address where your suppliers can send their invoices.' },
] as const;

export function Integrations() {
  const [params] = useSearchParams();
  const selected = channels.find(channel => channel.id === params.get('channel'));

  return <>
    {selected && <Link to="/app/integrations" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-slate-600 hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />{t('Back to integrations')}
    </Link>}
    <PageHeader title={selected ? t(selected.title) : t('Integrations')}
      subtitle={t(selected ? 'Connect the places where your invoices arrive.' : 'Choose how to send your invoices to Oli.')} />
    {selected ? <>
      {selected.id === 'telegram' && <TelegramIntegration />}
      {selected.id === 'skill' && <SkillIntegration />}
      {selected.id === 'email' && <EmailIntegration />}
    </> : <>
      <Card>
        <nav aria-label={t('Invoice channels')}>
          <ul className="divide-y divide-hairline">
            {channels.map(channel => <li key={channel.id}>
              <Link to={`/app/integrations?channel=${channel.id}`}
                className="group flex items-start gap-4 rounded-2xl p-5 transition-colors hover:bg-bone focus-visible:bg-bone sm:items-center sm:gap-6 sm:p-8 motion-reduce:transition-none">
                <channel.icon className="mt-1 size-7 shrink-0 text-ink sm:mt-0" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg text-ink">{t(channel.title)}</h2>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">{t(channel.description)}</p>
                  {'detail' in channel && <p className="mt-3 text-xs text-ash">{channel.detail}</p>}
                </div>
                <ArrowRight className="mt-1.5 size-5 shrink-0 text-ash group-hover:text-ink sm:mt-0" aria-hidden />
              </Link>
            </li>)}
          </ul>
        </nav>
      </Card>
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-slate-600">{t('Your company’s rules apply to every invoice, wherever it arrives.')}</p>
    </>}
  </>;
}

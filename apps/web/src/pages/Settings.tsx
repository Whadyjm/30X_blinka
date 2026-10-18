import { Link } from 'react-router';
import { RotateCcw } from 'lucide-react';
import { buttonClass } from '@/components/ui/Button';
import { InlineAlert, PageHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Field';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { useTelegramHistoryPreference } from '@/features/chat/useTelegramHistoryPreference';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';

export function Settings() {
  const me = useMe();
  const scope = me.data?.org ? `${me.data.org.id}:${me.data.user.id}` : '';
  const telegramHistory = useTelegramHistoryPreference(scope);
  return (
    <>
      <PageHeader title={t('Settings')} subtitle={t('Manage your preferences and the rules Oli follows.')} />
      <section className="mb-8 max-w-2xl space-y-4 border-t border-hairline pt-6" aria-labelledby="appearance-heading">
        <div className="space-y-2">
          <h2 id="appearance-heading" className="text-xl">{t('Appearance')}</h2>
          <p className="text-sm text-slate-600">{t('Choose light, warm dark, or follow your device. Saved in this browser.')}</p>
        </div>
        <ThemeSwitcher />
      </section>
      <section className="mb-8 max-w-2xl space-y-4 border-t border-hairline pt-6" aria-labelledby="chat-preferences-heading">
        <h2 id="chat-preferences-heading" className="text-xl">{t('Conversations')}</h2>
        <Toggle label={t('Show Telegram conversation on Home')} description={t('Only changes this browser’s view. Your Telegram bot stays connected.')}
          checked={telegramHistory.visible} onChange={telegramHistory.setVisible} disabled={!scope} />
      </section>
      <section className="max-w-2xl space-y-4 border-t border-hairline pt-6" aria-labelledby="company-setup-heading">
        <div className="space-y-2">
          <h2 id="company-setup-heading" className="text-xl">{t('Company setup')}</h2>
          <p className="text-sm text-slate-600">{t('Run onboarding again with your current rules prefilled. Your new rules take effect when you confirm them.')}</p>
          <p className="text-sm text-slate-600">{t('Your invoices, vendors and reserved budget stay in place.')}</p>
        </div>
        {me.data?.role === 'owner' ? (
          <Link to="/onboarding?restart=1" className={buttonClass('secondary')}>
            <RotateCcw className="size-4" aria-hidden /> {t('Restart onboarding')}
          </Link>
        ) : <InlineAlert tone="info">{t('Only an owner can restart onboarding and change the rules.')}</InlineAlert>}
      </section>
    </>
  );
}

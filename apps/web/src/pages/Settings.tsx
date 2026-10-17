import { Link } from 'react-router';
import { RotateCcw } from 'lucide-react';
import { buttonClass } from '@/components/ui/Button';
import { InlineAlert, PageHeader } from '@/components/ui/Card';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';

export function Settings() {
  const me = useMe();
  return (
    <>
      <PageHeader title={t('Settings')} subtitle={t('Manage your company setup and the rules Oli follows.')} />
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

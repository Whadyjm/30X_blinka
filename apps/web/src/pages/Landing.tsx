import { Link } from 'react-router';
import { Ban, CheckCircle2, Hand } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { brand } from '@/config/brand';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';

// Title/body are English i18n keys, translated at render time.
const OUTCOMES = [
  { Icon: CheckCircle2, title: 'Approved', body: 'Authorized vendor, matches the agreement, inside your limits, budget available. Approved.', cls: 'bg-highlighter text-ink' },
  { Icon: Hand, title: 'Needs approval', body: 'A real exception — like an amount above the automatic limit. Oli asks you and re-checks everything before confirming.', cls: 'bg-white text-ink ring-1 ring-inset ring-ink' },
  { Icon: Ban, title: 'Blocked', body: 'Duplicate, unauthorized vendor, over the ceiling or out of budget. A “yes” can’t override these.', cls: 'bg-ink text-white' },
];

export function Landing() {
  const me = useMe();
  const signedIn = !!me.data;
  const cta = signedIn ? '/app' : '/login';
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link to={cta} className={buttonClass('secondary', 'sm')}>
              {signedIn ? t('Open app') : t('Sign in')}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
          <h1 className="max-w-3xl text-[44px] leading-none text-ink sm:text-[64px]">{brand.tagline}</h1>
          <p className="mt-6 max-w-xl text-xl leading-[1.3] text-ash sm:text-2xl">
            {t('Give Oli your invoices and tell it what it may approve. It reviews each one against your rules and only interrupts you when it truly needs permission.')}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Beam>
              <Link to={cta} className={buttonClass('primary', 'lg')}>
                {brand.cta}
              </Link>
            </Beam>
            <a href="#outcomes" className={buttonClass('secondary', 'lg')}>
              {t('See how it decides')}
            </a>
          </div>
        </section>

        <section id="outcomes" aria-label={t('Possible outcomes')} className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 pb-24 sm:grid-cols-3 sm:px-6">
          {OUTCOMES.map(({ Icon, title, body, cls }) => (
            <div key={title} className="rounded-2xl border border-hairline bg-white p-6">
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${cls}`}>
                <Icon className="size-3.5" aria-hidden /> {t(title)}
              </span>
              <p className="mt-5 text-base leading-normal text-ink">{t(body)}</p>
            </div>
          ))}
        </section>

        <section className="bg-obsidian">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6">
            <p className="caption mb-4 !text-slate-400">{t('The idea')}</p>
            <p className="max-w-3xl text-[28px] leading-[1.14] text-white sm:text-[40px] sm:leading-[1.05]">{brand.pitch}</p>
          </div>
        </section>
      </main>

    </div>
  );
}

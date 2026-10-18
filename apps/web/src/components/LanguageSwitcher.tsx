import { LANGS, t } from '@/i18n';
import { useLang } from '@/i18n/I18nProvider';
import { cn } from '@/lib/cn';

/** EN | ES toggle. Persists in localStorage; remounts the UI in the new language. */
export function LanguageSwitcher({ className, dark = false }: { className?: string; dark?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label={t('Language')} className={cn('inline-flex overflow-hidden rounded-md', dark ? 'ring-1 ring-inset ring-white/30' : 'ring-1 ring-inset ring-hairline', className)}>
      {LANGS.map((l) => {
        const active = l.code === lang;
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            aria-pressed={active}
            title={l.name}
            onClick={() => setLang(l.code)}
            className={cn(
              'px-2.5 py-1 text-xs uppercase tracking-[0.05em]',
              active ? 'bg-highlighter text-on-accent' : dark ? 'text-white hover:bg-white/10' : 'bg-paper text-ash hover:bg-bone hover:text-ink',
            )}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

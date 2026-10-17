import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { applyLang, getLang, type Lang } from './index';

type Ctx = { lang: Lang; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx | null>(null);

/**
 * Holds the active language. Changing it remounts the children (key = lang) so every
 * plain `t()` call — including ones in module helpers — re-evaluates with the new language.
 * Server state (React Query cache) lives above this provider, so no data is refetched.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang());
  const setLang = useCallback((l: Lang) => {
    applyLang(l);
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return (
    <LangCtx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangCtx.Provider>
  );
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useLang must be used inside <I18nProvider>');
  return c;
}

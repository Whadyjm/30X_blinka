/**
 * Minimal i18n. The English source text IS the key, so call sites stay readable:
 *
 *   t('Approved')                       → "Aprobada" in Spanish
 *   t('{n} invoices need you', { n })   → interpolation with {name}
 *
 * Rules:
 *  - Unknown keys fall back to the English text (never crash, never show a key id).
 *  - Plurals: use two keys ("1 invoice" / "{n} invoices"), pick in code.
 *  - Module-level constants must keep ENGLISH text and be translated at render time: t(constant).
 *  - Language changes remount the UI tree (see I18nProvider), so plain t() calls are always current.
 *  - Text that comes from the server (decision explanations, audit details) is not translated here;
 *    the HTTP client sends `Accept-Language` so the backend can localize it.
 */
import { es } from './es';

export type Lang = 'en' | 'es';
export const LANGS: ReadonlyArray<{ code: Lang; label: string; name: string }> = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
];

const STORAGE_KEY = 'oli.lang';

function detect(): Lang {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Lang = detect();
const warned = new Set<string>();

export function getLang(): Lang {
  return current;
}

/** Locale tag for Intl / Date formatting. */
export function getLocale(): string {
  return current === 'es' ? 'es-US' : 'en-US';
}

export function applyLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export type Params = Record<string, string | number>;

export function t(en: string, params?: Params): string {
  let s = en;
  if (current === 'es') {
    const hit = es[en];
    if (hit !== undefined) s = hit;
    else if (import.meta.env?.DEV && !warned.has(en)) {
      warned.add(en);
      console.warn(`[i18n] missing ES translation: ${JSON.stringify(en)}`);
    }
  }
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : s;
}

if (typeof document !== 'undefined') document.documentElement.lang = current;

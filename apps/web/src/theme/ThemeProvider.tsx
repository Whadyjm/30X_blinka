import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type Theme = { preference: ThemePreference; resolved: 'light' | 'dark'; setPreference: (value: ThemePreference) => void };
const ThemeContext = createContext<Theme | null>(null);
export const THEME_STORAGE_KEY = 'oli.theme';
export const themePreference = (value: string | null): ThemePreference => value === 'light' || value === 'dark' ? value : 'system';

function readPreference() {
  try { return themePreference(localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return 'system'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setPreferenceState(readPreference());
    };
    media.addEventListener('change', change);
    window.addEventListener('storage', storage);
    change();
    return () => { media.removeEventListener('change', change); window.removeEventListener('storage', storage); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#191715' : '#f4f2f0');
  }, [resolved]);
  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    try { localStorage.setItem(THEME_STORAGE_KEY, value); } catch { /* Keep this session's choice. */ }
  }, []);
  const theme = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  // Oli also ships in standalone mascot examples outside the application provider.
  return theme ?? { preference: 'system', resolved: typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', setPreference: () => {} };
}

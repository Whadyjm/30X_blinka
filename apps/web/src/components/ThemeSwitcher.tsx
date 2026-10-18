import { Monitor, Moon, Sun } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { useTheme } from '@/theme/ThemeProvider';

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, resolved, setPreference } = useTheme();
  if (compact) {
    const label = t(resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    return <button type="button" aria-label={label} title={label} onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-hairline bg-paper text-ink hover:bg-bone">
      {resolved === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>;
  }
  return <div role="group" aria-label={t('Appearance')} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-hairline bg-paper p-1">
    {([{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'system', label: 'System', Icon: Monitor }] as const).map(({ value, label, Icon }) => <button key={value} type="button" aria-pressed={preference === value}
      aria-label={t(label)} title={t(label)} onClick={() => setPreference(value)}
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors', preference === value ? 'bg-highlighter text-on-accent' : 'text-ash hover:bg-bone hover:text-ink')}>
      <Icon className="size-4" aria-hidden /><span>{t(label)}</span>
    </button>)}
  </div>;
}

import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Loading indicator (Libraries.dev "thinking orb"). Replaces the generic spinner everywhere.
 *
 *  - size 20 = inline-with-text scale, size 64 = page/avatar scale (the only two hand-tuned sizes).
 *  - Uses the app's resolved theme. Explicit overrides cover accent and inverse buttons.
 *  - Freezes when the user prefers reduced motion.
 *  - Decorative by default (aria-hidden): the surrounding text/`role="status"` carries the meaning.
 */
export function Orb({ size = 20, state = 'working', theme, className }: { size?: 20 | 64; state?: OrbState; theme?: 'light' | 'dark'; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const { resolved } = useTheme();
  return <ThinkingOrb state={state} size={size} theme={theme ?? resolved} paused={reduced} className={className} aria-hidden="true" role="presentation" />;
}

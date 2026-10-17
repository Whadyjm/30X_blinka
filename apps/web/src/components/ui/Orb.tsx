import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

/**
 * Loading indicator (Libraries.dev "thinking orb"). Replaces the generic spinner everywhere.
 *
 *  - size 20 = inline-with-text scale, size 64 = page/avatar scale (the only two hand-tuned sizes).
 *  - `theme` is pinned: the app is light-only, so the orb must NOT follow the OS dark mode
 *    (light ink on our light surfaces would be invisible). Pass theme="dark" on dark surfaces.
 *  - Freezes when the user prefers reduced motion.
 *  - Decorative by default (aria-hidden): the surrounding text/`role="status"` carries the meaning.
 */
export function Orb({ size = 20, state = 'working', theme = 'light', className }: { size?: 20 | 64; state?: OrbState; theme?: 'light' | 'dark'; className?: string }) {
  const reduced = usePrefersReducedMotion();
  return <ThinkingOrb state={state} size={size} theme={theme} paused={reduced} className={className} aria-hidden="true" role="presentation" />;
}

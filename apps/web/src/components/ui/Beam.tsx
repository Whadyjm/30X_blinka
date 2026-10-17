import type { ReactNode } from 'react';
import { BorderBeam } from 'border-beam';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

/**
 * Libraries.dev "Beam" around a primary CTA.
 *
 * Why these settings (verified in a real browser, see git history of this file):
 *  - `pulse-outside` blooms a halo OUTSIDE the button. The border-hugging presets (`sm`, `md`, `line`)
 *    draw a ~1px stroke clipped inside the button edge and are practically invisible on a chartreuse fill.
 *  - `colorful`: the library's `mono` variant is intentionally rendered at 14–50% opacity, so it vanishes
 *    on our light surfaces.
 *  - `theme="dark"` is the tuning that reads on a light page for the outward halo. It is pinned (not `auto`)
 *    so it doesn't change with the OS colour scheme.
 *
 * Reserved for the few primary actions that matter — don't wrap every button. Pauses for reduced-motion
 * users and while `active` is false (e.g. the wrapped button is disabled or loading).
 */
export function Beam({ children, active = true, block = false }: { children: ReactNode; active?: boolean; block?: boolean }) {
  const reduced = usePrefersReducedMotion();
  return (
    <BorderBeam size="pulse-outside" colorVariant="colorful" theme="dark" strength={0.9} borderRadius={6} active={active && !reduced} className={block ? 'flex w-full' : 'inline-flex'}>
      {children}
    </BorderBeam>
  );
}

import { useEffect, useState } from 'react';
import { brand } from '@/config/brand';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { Oli } from './Oli';
import '@/styles/logo.css';

export function Logo({ light = false, mascot = false }: { light?: boolean; mascot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {mascot ? <LogoMascot light={light} /> : <span className="grid size-8 place-items-center rounded-md bg-ink" aria-hidden>
        <span className="size-3.5 rounded-full border-[3px] border-highlighter" />
      </span>}
      <span className={`text-xl tracking-tight ${light ? 'text-white' : 'text-ink'}`}>{brand.name}</span>
    </span>
  );
}

function LogoMascot({ light }: { light: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [greeting, setGreeting] = useState(false);

  useEffect(() => {
    setGreeting(false);
    if (reduced) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const greet = setInterval(() => {
      if (document.hidden) return;
      setGreeting(true);
      settle = setTimeout(() => setGreeting(false), 3400);
    }, 14000);
    return () => { clearInterval(greet); clearTimeout(settle); };
  }, [reduced]);

  const state = !reduced && (hovered || greeting) ? 'happy' : 'idle';
  return (
    <span
      className="oli-logo-mascot"
      aria-hidden="true"
      data-oli-state={state}
      onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="oli-logo-glow" />
      <Oli state={state} size={40} particles={360} speed={0.55} dark={light} paused={reduced} />
    </span>
  );
}

import { useEffect, useRef } from 'react';
import { OliCanvas } from '../../../../packages/oli/src/renderer.js';
import type { OliOptions, OliState } from '../../../../packages/oli/src/renderer.d.ts';

export type { OliState };
export interface OliProps extends OliOptions {
  size?: number;
  className?: string;
  label?: string;
}

export function Oli({
  state = 'idle',
  size = 240,
  speed = 1,
  dark = false,
  paused = false,
  particles = 1600,
  className,
  label = 'Oli',
}: OliProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<OliCanvas | null>(null);
  const latest = useRef({ state, speed, dark, paused });
  latest.current = { state, speed, dark, paused };

  useEffect(() => {
    if (!canvas.current) return;
    const instance = new OliCanvas(canvas.current, { ...latest.current, particles });
    renderer.current = instance;
    return () => {
      instance.destroy();
      renderer.current = null;
    };
  }, [particles]);

  useEffect(() => {
    renderer.current?.setOptions({ state, speed, dark, paused });
  }, [state, speed, dark, paused]);

  return (
    <canvas
      ref={canvas}
      className={className}
      role="img"
      aria-label={label}
      style={{ display: 'block', width: size, height: 'auto', maxWidth: '100%', aspectRatio: '1' }}
    />
  );
}

import { useEffect, useRef } from 'react';
import { OliCanvas } from './renderer.js';
import type { OliOptions, OliState } from './renderer.js';

export type { OliState };
export interface OliProps extends OliOptions {
  size?: number;
  className?: string;
  label?: string;
}

export function Oli({ state = 'idle', size = 240, speed = 1, dark = true, paused = false, particles = 1600, className, label = 'Oli' }: OliProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<OliCanvas | null>(null);
  // Keep creation separate from state updates, including React Strict Mode remounts.
  const latest = useRef({ state, speed, dark, paused });
  latest.current = { state, speed, dark, paused };

  useEffect(() => {
    if (!canvas.current) return;
    const instance = new OliCanvas(canvas.current, { ...latest.current, particles });
    renderer.current = instance;
    return () => { instance.destroy(); renderer.current = null; };
  }, [particles]);

  useEffect(() => {
    renderer.current?.setOptions({ state, speed, dark, paused });
  }, [state, speed, dark, paused]);

  return <canvas
    ref={canvas}
    className={className}
    role="img"
    aria-label={label}
    style={{ display: 'block', width: size, height: 'auto', maxWidth: '100%', aspectRatio: '1' }}
  />;
}

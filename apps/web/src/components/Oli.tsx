import { useEffect, useRef } from 'react';
import { OliCanvas } from '../../../../packages/oli/src/renderer.js';
import type { OliOptions, OliState } from '../../../../packages/oli/src/renderer.d.ts';
import { useTheme } from '@/theme/ThemeProvider';

export type { OliState };
export interface OliProps extends OliOptions {
  size?: number;
  className?: string;
  label?: string;
  followCursor?: boolean;
}

export function Oli({
  state = 'idle',
  size = 240,
  speed = 1,
  dark: darkOverride,
  paused = false,
  particles = 1600,
  className,
  label = 'Oli',
  followCursor = false,
}: OliProps) {
  const { resolved } = useTheme();
  const dark = darkOverride ?? resolved === 'dark';
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

  useEffect(() => {
    if (!followCursor || paused) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const track = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = canvas.current?.getBoundingClientRect();
        if (!rect) return;
        renderer.current?.lookAt(
          (x - rect.left - rect.width / 2) / Math.max(rect.width, innerWidth * 0.4),
          (y - rect.top - rect.height / 2) / Math.max(rect.height, innerHeight * 0.4),
        );
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      renderer.current?.lookAt(0, 0);
    };
    document.addEventListener('pointermove', track, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      document.removeEventListener('pointermove', track);
      document.documentElement.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
    };
  }, [followCursor, paused, particles]);

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

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Same hierarchy as the status badges: highlighter = positive/active, ink = hard stop, outline = attention.
const TONES = {
  ok: 'bg-highlighter text-on-accent',
  bad: 'bg-ink text-on-ink',
  warn: 'bg-paper text-ink ring-1 ring-inset ring-ink',
  muted: 'bg-bone text-ash',
  info: 'bg-bone text-ink',
} as const;

export function Badge({ tone = 'muted', children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-2.5 py-1 text-xs', TONES[tone], className)}>{children}</span>;
}

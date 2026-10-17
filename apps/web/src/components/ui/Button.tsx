import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'accent';
type Size = 'sm' | 'md' | 'lg';

/*
 * Ramp buttons: 6px radius rectangles, no shadow.
 *  primary   = Highlighter fill + Ink text (the only chromatic button)
 *  secondary = transparent + 1px Ink border
 *  ghost     = transparent, Bone on hover
 *  danger/success/accent map onto the same system (ink fill / highlighter) — no extra hues.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-highlighter text-ink hover:bg-[#d6e41a] disabled:bg-smoke disabled:text-ash',
  secondary: 'bg-transparent text-ink ring-1 ring-inset ring-ink hover:bg-bone disabled:text-slate-400 disabled:ring-smoke',
  ghost: 'text-ink hover:bg-bone disabled:text-slate-400',
  danger: 'bg-ink text-white hover:bg-obsidian disabled:bg-smoke disabled:text-ash',
  accent: 'bg-highlighter text-ink hover:bg-[#d6e41a] disabled:bg-smoke disabled:text-ash',
  success: 'bg-highlighter text-ink hover:bg-[#d6e41a] disabled:bg-smoke disabled:text-ash',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

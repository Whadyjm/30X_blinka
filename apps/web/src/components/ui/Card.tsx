import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/api/errors';
import { t } from '@/i18n';
import { Button } from './Button';
import { Orb } from './Orb';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-hairline bg-white', className)} {...rest} />;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-500">
      <Orb size={20} />
      {label ?? t('Loading')}…
    </span>
  );
}

export function PageLoading({ label }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center">
      <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
        <Orb size={64} />
        <span>{label ?? t('Loading')}…</span>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-bone text-ash">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="font-medium text-slate-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-ink text-white">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-slate-900">{title ?? t('Couldn’t load this')}</p>
      <p className="max-w-md text-sm text-slate-600">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
          {t('Try again')}
        </Button>
      )}
    </div>
  );
}

export function InlineAlert({ tone = 'error', children }: { tone?: 'error' | 'warn' | 'info' | 'success'; children: ReactNode }) {
  // Monochrome hierarchy: error = solid ink, warn = ink outline, info = bone, success = highlighter.
  const tones = {
    error: 'bg-ink text-white',
    warn: 'bg-white text-ink ring-1 ring-inset ring-ink',
    info: 'bg-bone text-slate-700',
    success: 'bg-highlighter text-ink',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl px-4 py-3 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

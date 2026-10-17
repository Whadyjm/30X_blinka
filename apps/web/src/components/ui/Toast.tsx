import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';

type ToastItem = { id: number; tone: 'success' | 'error'; text: string };
type Ctx = { success: (text: string) => void; error: (text: string) => void };

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 8000 : 4000);
  }, []);
  const api = useMemo<Ctx>(() => ({ success: (text) => push('success', text), error: (text) => push('error', text) }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm',
              toast.tone === 'success' ? 'bg-highlighter text-ink' : 'bg-ink text-white',
            )}
          >
            {toast.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>{toast.text}</span>
            <button type="button" className="ml-2 opacity-60 hover:opacity-100" aria-label={t('Dismiss')} onClick={() => setItems((x) => x.filter((i) => i.id !== toast.id))}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return c;
}

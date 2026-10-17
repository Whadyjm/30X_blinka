import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { fromMinor, toMinor } from '@/lib/money';

const control =
  'block w-full rounded-[10px] border-0 bg-white px-4 py-2.5 text-sm text-ink ring-1 ring-inset ring-[rgba(33,33,33,0.15)] placeholder:text-slate-400 focus:ring-2 focus:ring-ink disabled:bg-bone disabled:text-ash';

type FieldShellProps = { label: string; hint?: ReactNode; error?: string | null; id: string; children: ReactNode; optional?: boolean };

function FieldShell({ label, hint, error, id, children, optional }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
        {optional && <span className="ml-1 font-normal text-slate-400">({t('optional')})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { label: string; hint?: ReactNode; error?: string | null; optional?: boolean };

export function TextField({ label, hint, error, optional, className, ...rest }: TextProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} className={cn(control, error && 'ring-rose-400', className)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...rest} />
    </FieldShell>
  );
}

type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string; hint?: ReactNode; error?: string | null };
export function TextAreaField({ label, hint, error, className, ...rest }: AreaProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea id={id} className={cn(control, 'min-h-20', error && 'ring-rose-400', className)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...rest} />
    </FieldShell>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { label: string; hint?: ReactNode; error?: string | null };
export function SelectField({ label, hint, error, children, className, ...rest }: SelectProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} className={cn(control, className)} aria-invalid={!!error} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

/**
 * Money input in MAJOR units for humans, MINOR units for the app. No floats:
 * text → toMinor() (string math). Shows what it understood; rejects extra decimals instead of rounding.
 */
export function MoneyField({
  label,
  currency,
  valueMinor,
  onChange,
  hint,
  error,
  disabled,
}: {
  label: string;
  currency: string;
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(valueMinor == null ? '' : fromMinor(valueMinor, currency));
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error ?? localErr}>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          className={cn(control, 'pr-14', (error ?? localErr) && 'ring-rose-400')}
          value={text}
          aria-invalid={!!(error ?? localErr)}
          aria-describedby={error ?? localErr ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw.trim() === '') {
              setLocalErr(null);
              onChange(null);
              return;
            }
            const m = toMinor(raw, currency);
            if (m == null) {
              setLocalErr(t('Enter a valid amount, e.g. 1,250.00'));
              onChange(null);
            } else {
              setLocalErr(null);
              onChange(m);
            }
          }}
          onBlur={() => {
            const m = toMinor(text, currency);
            if (m != null) setText(fromMinor(m, currency));
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-500">{currency}</span>
      </div>
    </FieldShell>
  );
}

export function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
          {label}
        </label>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-md transition-colors disabled:opacity-50', checked ? 'bg-ink' : 'bg-smoke')}
      >
        <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-[4px] bg-white transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600" />
      <label htmlFor={id} className="text-sm text-slate-800">
        {label}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  );
}

import { CheckCircle2, CircleAlert, Info, XCircle } from 'lucide-react';
import type { PolicyDecision, TraceStep } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { buildTrace } from '@/lib/trace';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Result is carried by icon shape + label (single-accent palette: no red/green).
// `label` values are English i18n keys, translated at render time.
const ICON = {
  PASS: { Icon: CheckCircle2, cls: 'text-ink', label: 'Passed' },
  FAIL: { Icon: XCircle, cls: 'text-ink', label: 'Failed' },
  WARN: { Icon: CircleAlert, cls: 'text-ink', label: 'Needs attention' },
  INFO: { Icon: Info, cls: 'text-ash', label: 'Info' },
} as const;

/**
 * Decision Trace (§4.4 / §9.5): data → rule → version → result → evidence → date.
 * Renders only what the server persisted (reasons + facts + optional trace).
 */
export function DecisionTrace({ decision }: { decision: PolicyDecision }) {
  const steps = buildTrace(decision);
  if (steps.length === 0) {
    return <p className="px-5 py-4 text-sm text-slate-500">{t('No rule details were recorded for this decision.')}</p>;
  }
  return (
    <ol className="divide-y divide-hairline" aria-label={t('Decision trace')}>
      {steps.map((s, i) => (
        <TraceRow key={`${s.rule}-${i}`} step={s} index={i + 1} fallbackVersion={decision.policyVersion} fallbackAt={decision.checkedAt} />
      ))}
    </ol>
  );
}

function TraceRow({ step, index, fallbackVersion, fallbackAt }: { step: TraceStep; index: number; fallbackVersion: unknown; fallbackAt?: string }) {
  const info = reasonInfo(step.rule);
  const r = ICON[step.result];
  const version = step.policyVersion ?? fallbackVersion;
  const at = step.checkedAt ?? fallbackAt;
  return (
    <li className="flex gap-3 px-5 py-4">
      <r.Icon className={cn('mt-0.5 size-5 shrink-0', r.cls)} aria-label={t(r.label)} role="img" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="mr-1.5 text-slate-400">{index}.</span>
          {info.label}
          <span className="ml-2 text-xs uppercase tracking-[0.05em] text-ash">{t(r.label)}</span>
        </p>
        <p className="text-sm text-slate-500">{info.rule}</p>
        {(step.observed || step.expected) && (
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {step.field && (
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-slate-500">{t('Checked')}</dt>
                <dd className="text-ink">{step.field}</dd>
              </div>
            )}
            {step.observed && (
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-slate-500">{t('Found')}</dt>
                <dd className="min-w-0 break-words text-data text-ink">{step.observed}</dd>
              </div>
            )}
            {step.expected && (
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-slate-500">{t('Rule')}</dt>
                <dd className="text-data text-ink">{step.expected}</dd>
              </div>
            )}
          </dl>
        )}
        {step.evidence && step.rule !== 'DOCUMENT_TYPE' && (
          <p className="mt-1 break-words text-sm italic text-slate-600 [overflow-wrap:anywhere]">“{step.evidence}”</p>
        )}
        <p className="caption mt-1.5 normal-case tracking-normal">
          {version != null && version !== '' ? t('Policy v{n}', { n: String(version) }) : t('Policy version n/a')}
          {at ? ` · ${formatDateTime(at)}` : ''}
          {!['DOCUMENT_TYPE', 'NOT_AN_INVOICE', 'DOCUMENT_TYPE_UNCERTAIN'].includes(step.rule) && (
            <span className="text-data ml-1 text-xs text-slate-400">· {step.rule}</span>
          )}
        </p>
      </div>
    </li>
  );
}

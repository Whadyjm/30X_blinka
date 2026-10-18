import { AlertCircle, Ban, CheckCircle2, Clock, Info, ShieldCheck } from 'lucide-react';
import type { PolicyDecision, TraceStep } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { buildTrace, parseEvidenceFacts } from '@/lib/trace';

interface StepTheme {
  dotClass: string;
  badgeClass: string;
  icon: typeof CheckCircle2;
  label: string;
}

const OUTCOME_THEME: Record<TraceStep['result'], StepTheme> = {
  PASS: {
    dotClass: 'bg-highlighter text-on-accent ring-2 ring-ink',
    badgeClass: 'bg-highlighter text-on-accent font-medium',
    icon: CheckCircle2,
    label: 'Passed',
  },
  FAIL: {
    dotClass: 'bg-ink text-on-ink ring-2 ring-ink',
    badgeClass: 'bg-ink text-on-ink',
    icon: Ban,
    label: 'Failed',
  },
  WARN: {
    dotClass: 'bg-paper text-ink ring-2 ring-ink',
    badgeClass: 'bg-paper text-ink ring-1 ring-inset ring-ink',
    icon: AlertCircle,
    label: 'Needs attention',
  },
  INFO: {
    dotClass: 'bg-bone text-slate-600 ring-1 ring-hairline',
    badgeClass: 'bg-bone text-slate-700',
    icon: Info,
    label: 'Info',
  },
};

/**
 * Intuitive Decision Trace (§4.4 / §9.5):
 * Visual step-by-step timeline with dots connecting each check.
 * Strictly no raw JSON dumps — evidence is parsed into clean, human-readable facts.
 */
export function DecisionTrace({ decision }: { decision: PolicyDecision }) {
  const steps = buildTrace(decision);

  if (steps.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-500">{t('No rule details were recorded for this decision.')}</p>;
  }

  const passedCount = steps.filter((s) => s.result === 'PASS').length;
  const warnCount = steps.filter((s) => s.result === 'WARN').length;
  const failCount = steps.filter((s) => s.result === 'FAIL').length;

  return (
    <div className="p-5 sm:p-6" aria-label={t('Decision trace')}>
      {/* Top summary overview */}
      <div className="mb-8 rounded-xl border border-hairline bg-bone/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-ink" aria-hidden />
            <h3 className="text-sm font-normal text-ink">
              {t('{n} checks evaluated', { n: steps.length })}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {passedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-highlighter px-2.5 py-1 text-on-accent">
                <CheckCircle2 className="size-3.5" aria-hidden />
                {t('{n} passed', { n: passedCount })}
              </span>
            )}
            {warnCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-paper px-2.5 py-1 text-ink ring-1 ring-inset ring-ink">
                <Clock className="size-3.5" aria-hidden />
                {t('{n} need attention', { n: warnCount })}
              </span>
            )}
            {failCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-on-ink">
                <Ban className="size-3.5" aria-hidden />
                {t('{n} blocked', { n: failCount })}
              </span>
            )}
          </div>
        </div>

        {/* Mini dot rail */}
        <div className="mt-3.5 flex items-center gap-1.5" aria-hidden>
          {steps.map((s, idx) => (
            <div
              key={idx}
              className={cn(
                'h-1.5 flex-1 rounded-sm transition-all',
                s.result === 'PASS'
                  ? 'bg-highlighter'
                  : s.result === 'FAIL'
                    ? 'bg-ink'
                    : s.result === 'WARN'
                      ? 'bg-slate-400'
                      : 'bg-slate-300'
              )}
              title={`${s.rule}: ${t(OUTCOME_THEME[s.result].label)}`}
            />
          ))}
        </div>
      </div>

      {/* Timeline track with prominent nodes/dots */}
      <div className="relative pl-7 sm:pl-8">
        {/* Continuous vertical timeline stem */}
        <div
          className="absolute left-[13px] sm:left-[15px] top-4 bottom-4 w-[2px] bg-hairline"
          aria-hidden
        />

        <ol className="space-y-6">
          {steps.map((step, idx) => (
            <TimelineStep
              key={`${step.rule}-${idx}`}
              step={step}
              index={idx + 1}
              isLast={idx === steps.length - 1}
              currency={decision.facts.currency}
              fallbackVersion={decision.policyVersion}
              fallbackAt={decision.checkedAt}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function TimelineStep({
  step,
  index,
  currency,
  fallbackVersion,
  fallbackAt,
}: {
  step: TraceStep;
  index: number;
  isLast?: boolean;
  currency?: string;
  fallbackVersion?: unknown;
  fallbackAt?: string;
}) {
  const info = reasonInfo(step.rule);
  const theme = OUTCOME_THEME[step.result];
  const StepIcon = theme.icon;
  const version = step.policyVersion ?? fallbackVersion;
  const at = step.checkedAt ?? fallbackAt;

  // Extract facts without raw JSON
  const evidenceFacts = parseEvidenceFacts(step.evidence, currency);

  // Check if comparison details exist
  const hasComparison = Boolean(step.field || step.expected || (step.observed && step.expected));

  return (
    <li className="relative group">
      {/* Prominent timeline dot */}
      <div
        className={cn(
          'absolute -left-[27px] sm:-left-[31px] top-1.5 z-10 flex size-7 sm:size-8 items-center justify-center rounded-full shadow-sm ring-4 ring-paper transition-transform group-hover:scale-105',
          theme.dotClass
        )}
        aria-hidden
      >
        <StepIcon className="size-4" />
      </div>

      {/* Step card container */}
      <div className="rounded-xl border border-hairline bg-paper p-4 sm:p-5 transition-colors hover:border-slate-300">
        {/* Header: Title, index and outcome badge */}
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-normal text-slate-400">#{index}</span>
              <h4 className="text-[15px] leading-snug text-ink">{info.label}</h4>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{info.rule}</p>
          </div>

          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
              theme.badgeClass
            )}
          >
            <StepIcon className="size-3.5" aria-hidden />
            {t(theme.label)}
          </span>
        </div>

        {/* Plain language explanation from the engine */}
        {step.observed && (
          <p className="mt-3 text-sm leading-relaxed text-slate-800">
            {step.observed}
          </p>
        )}

        {/* Structured comparison box */}
        {hasComparison && (
          <div className="mt-3.5 rounded-lg border border-hairline bg-bone/40 p-3">
            <dl className="grid gap-3 sm:grid-cols-3 text-xs">
              {step.field && (
                <div>
                  <dt className="text-slate-500">{t('Checked')}</dt>
                  <dd className="mt-0.5 font-normal text-ink">{step.field}</dd>
                </div>
              )}
              {step.observed && (
                <div>
                  <dt className="text-slate-500">{t('Found')}</dt>
                  <dd className="mt-0.5 font-normal text-data text-ink break-words">
                    {step.observed}
                  </dd>
                </div>
              )}
              {step.expected && (
                <div>
                  <dt className="text-slate-500">{t('Rule')}</dt>
                  <dd className="mt-0.5 font-normal text-data text-ink">{step.expected}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Evidence facts formatted as clean badges (NO JSON DUMP) */}
        {evidenceFacts.length > 0 && (
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-hairline/60">
            <span className="text-[11px] text-slate-400 mr-1">{t('Facts')}:</span>
            {evidenceFacts.map((fact, fIdx) => (
              <span
                key={fIdx}
                className="inline-flex items-center gap-1 rounded-md bg-bone px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-hairline"
              >
                <span className="text-slate-500">{fact.label}:</span>
                <span className="text-ink font-normal">{fact.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Step footer metadata */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span>
              {version != null && version !== ''
                ? t('Policy v{n}', { n: String(version) })
                : t('Policy version n/a')}
            </span>
            {at && (
              <>
                <span>·</span>
                <span>{formatDateTime(at)}</span>
              </>
            )}
          </div>
          {!['DOCUMENT_TYPE', 'NOT_AN_INVOICE', 'DOCUMENT_TYPE_UNCERTAIN'].includes(step.rule) && (
            <span className="font-mono text-[10px] text-slate-400">
              {step.rule}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

import { AlertCircle, Ban, CheckCircle2, Clock, Info, ShieldCheck } from 'lucide-react';
import type { ExtractedInvoice, PolicyDecision, TraceStep } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { buildTrace } from '@/lib/trace';
import { extractionExplanation } from '@/lib/extraction-explanation';

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
 * Reading uncertainty is explained here; original evidence remains in Logs.
 */
export function DecisionTrace({ decision, extracted }: { decision: PolicyDecision; extracted?: ExtractedInvoice | null }) {
  const steps = buildTrace(decision);

  if (steps.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-500">{t('No rule details were recorded for this decision.')}</p>;
  }

  const passedCount = steps.filter((s) => s.result === 'PASS').length;
  const warnCount = steps.filter((s) => s.result === 'WARN').length;
  const failCount = steps.filter((s) => s.result === 'FAIL').length;
  const stoppedAtReading = decision.trace?.some(step => step.rule === 'EXTRACTION' && step.result !== 'PASS')
    && decision.trace.every(step => ['DOCUMENT_TYPE', 'EXTRACTION', 'DUPLICATE_HASH'].includes(step.rule));

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
              title={`${reasonInfo(s.rule).label}: ${t(OUTCOME_THEME[s.result].label)}`}
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
              extracted={extracted}
            />
          ))}
        </ol>
      </div>
      {stoppedAtReading && <p className="mt-5 max-w-prose text-sm leading-relaxed text-slate-700">
        {t('The review stopped at the document reading. Vendor authorization, amount limits and budget have not been checked yet.')}
      </p>}
    </div>
  );
}

function TimelineStep({ step, extracted }: { step: TraceStep; extracted?: ExtractedInvoice | null }) {
  const info = reasonInfo(step.rule);
  const theme = OUTCOME_THEME[step.result];
  const StepIcon = theme.icon;
  const isReading = step.rule === 'EXTRACTION';
  const messages = isReading
    ? step.result === 'PASS'
      ? [t(step.evidence?.includes('HUMAN_CONFIRMED')
        ? 'A person reviewed the original and confirmed these invoice details.'
        : 'I checked the vendor, total, currency and due date. The invoice must also meet your spending rules.')]
      : extractionExplanation(extracted, step)
    : [step.observed || info.rule];

  return (
    <li className="relative">
      <div
        className={cn('absolute -left-[27px] sm:-left-[31px] top-1.5 flex size-7 sm:size-8 items-center justify-center rounded-full ring-4 ring-paper', theme.dotClass)}
        aria-hidden
      >
        <StepIcon className="size-4" />
      </div>
      <div className="border-b border-hairline pb-5">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <h4 className="min-w-0 flex-1 text-[15px] leading-snug text-ink">
            {isReading ? t('Checking the invoice details') : info.label}
          </h4>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs', theme.badgeClass)}>
            <StepIcon className="size-3.5" aria-hidden />
            {t(theme.label)}
          </span>
        </div>
        <div className="mt-3 max-w-prose space-y-2 text-sm leading-relaxed text-slate-700">
          {messages.map((message, i) => <p key={i}>{message}</p>)}
          {!isReading && step.expected && (
            <p className="text-slate-600">{t('What is needed: {requirement}', { requirement: step.expected })}</p>
          )}
        </div>
      </div>
    </li>
  );
}

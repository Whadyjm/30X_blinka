import { AlertCircle, Ban, CheckCircle2, Hand, XCircle, type LucideIcon } from 'lucide-react';
import { Bot, User } from 'lucide-react';
import { Orb } from '@/components/ui/Orb';
import type { InvoiceSource } from '@/contracts';
import { reasonInfo, type ReasonTone } from '@/contracts/reasons';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { outcomeLabel, type Outcome } from '@/lib/outcome';

/*
 * Status hierarchy without hue (single-accent system):
 *   Approved       → Highlighter fill  (money moved forward — the one accent)
 *   Blocked        → Ink solid, white text (hard stop)
 *   Needs approval → white + 1px Ink outline (waiting on a person)
 *   Processing     → Bone, Ash text
 *   Failed         → dashed Ink outline (nothing was approved)
 *   Rejected       → Bone with Smoke ring
 * Every state also has its own icon + label, so color is never the only signal.
 * `title` values are English i18n keys, translated at render time.
 */
const STYLES: Record<Outcome, { cls: string; Icon: LucideIcon; title: string }> = {
  APPROVED: { cls: 'bg-highlighter text-ink', Icon: CheckCircle2, title: 'Approved for simulated payment' },
  BLOCKED: { cls: 'bg-ink text-white', Icon: Ban, title: 'Blocked by your rules' },
  NEEDS_APPROVAL: { cls: 'bg-white text-ink ring-1 ring-inset ring-ink', Icon: Hand, title: 'Needs a human decision' },
  NEEDS_REVIEW: { cls: 'bg-bone text-ink ring-1 ring-inset ring-smoke', Icon: AlertCircle, title: 'Needs correction or clarification' },
  PROCESSING: { cls: 'bg-bone text-ash', Icon: AlertCircle, title: 'Being processed' },
  FAILED: { cls: 'bg-white text-ink border border-dashed border-ink', Icon: AlertCircle, title: 'Processing failed. Nothing was approved.' },
  REJECTED: { cls: 'bg-bone text-ash ring-1 ring-inset ring-smoke', Icon: XCircle, title: 'Rejected by a reviewer' },
};

export function OutcomeBadge({ outcome, className }: { outcome: Outcome; className?: string }) {
  const s = STYLES[outcome];
  return (
    <span title={t(s.title)} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs', s.cls, className)}>
      {outcome === 'PROCESSING' ? <Orb size={20} className="-my-1 -ml-1.5" /> : <s.Icon className="size-3.5" aria-hidden />}
      {outcomeLabel(outcome)}
    </span>
  );
}

const TONE: Record<ReasonTone, string> = {
  ok: 'bg-bone text-ink',
  warn: 'bg-white text-ink ring-1 ring-inset ring-ink',
  block: 'bg-ink text-white',
  info: 'bg-bone text-ash',
};

export function ReasonChips({ reasons, max }: { reasons: string[]; max?: number }) {
  const shown = max ? reasons.slice(0, max) : reasons;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((r) => {
        const info = reasonInfo(r);
        return (
          <li key={r} title={r} className={cn('rounded-md px-2 py-0.5 text-xs', TONE[info.tone])}>
            {info.label}
          </li>
        );
      })}
      {max && reasons.length > max && <li className="rounded-md bg-bone px-2 py-0.5 text-xs text-ash">+{reasons.length - max}</li>}
    </ul>
  );
}

export function SourceBadge({ source, agentName }: { source: InvoiceSource; agentName?: string | null }) {
  const agent = source === 'AGENT_REQUEST';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      {agent ? <Bot className="size-3.5" aria-hidden /> : <User className="size-3.5" aria-hidden />}
      {agent ? (agentName ?? t('Agent')) : t('Upload')}
    </span>
  );
}

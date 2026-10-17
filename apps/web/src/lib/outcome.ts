import type { InvoiceSummary } from '@/contracts';
import { t } from '@/i18n';

/**
 * What the user sees. Derived ONLY from what the server returned (decision / approval / status).
 * Fail-closed on display: anything not clearly decided is "PROCESSING" or "FAILED", never "APPROVED".
 */
export type Outcome = 'PROCESSING' | 'FAILED' | 'APPROVED' | 'BLOCKED' | 'NEEDS_APPROVAL' | 'NEEDS_REVIEW' | 'REJECTED';

type OutcomeInput = Pick<InvoiceSummary, 'status' | 'decision' | 'approval'>;

export function getOutcome(inv: OutcomeInput): Outcome {
  const approval = inv.approval?.state;
  if (inv.status === 'FAILED') return 'FAILED';

  switch (inv.decision?.decision) {
    case 'APPROVE':
      return 'APPROVED';
    case 'BLOCK':
      return approval === 'REJECTED' ? 'REJECTED' : 'BLOCKED';
    case 'ESCALATE':
      return approval === 'PENDING' && inv.approval?.canDecide === true ? 'NEEDS_APPROVAL' : 'NEEDS_REVIEW';
  }

  // No decision object (compact list endpoints): fall back to the business status the server sent.
  switch (inv.status) {
    case 'APPROVED':
      return 'APPROVED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'NEEDS_APPROVAL':
      return 'NEEDS_APPROVAL';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'PROCESSING';
  }
}

/** True while the backend is still working → UI should poll. */
export function isInFlight(inv: OutcomeInput): boolean {
  return getOutcome(inv) === 'PROCESSING';
}

/** English source labels (keys). Always read through `outcomeLabel()` so they are translated at render time. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  PROCESSING: 'Processing',
  FAILED: 'Failed — not approved',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  NEEDS_APPROVAL: 'Needs approval',
  NEEDS_REVIEW: 'Needs review',
  REJECTED: 'Rejected',
};

export function outcomeLabel(o: Outcome): string {
  return t(OUTCOME_LABEL[o]);
}

export const PROCESSING_STEPS = ['RECEIVED', 'PARSING', 'READY', 'PROCESSING', 'DECIDED'] as const;

export function processingLabel(status: string): string {
  switch (status) {
    case 'RECEIVED':
      return t('Received');
    case 'PARSING':
      return t('Reading the document…');
    case 'READY':
      return t('Ready for review');
    case 'PROCESSING':
      return t('Checking your rules…');
    default:
      return t('Processing');
  }
}

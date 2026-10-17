/**
 * Presentation-only catalog for reason codes. It labels what the server decided;
 * it never decides anything. Unknown codes fall back to a humanized string.
 * Text here is ENGLISH (it is the i18n key); `reasonInfo()` translates at call time.
 */
import { t } from '@/i18n';
import type { Decision } from './index';

export type ReasonTone = 'ok' | 'warn' | 'block' | 'info';

export type ReasonInfo = {
  label: string;
  /** What the rule checks, in plain language (used in the Decision Trace). */
  rule: string;
  tone: ReasonTone;
  /** Can an owner/approver ever override this with a "yes"? (§4.5) */
  humanApprovable: boolean;
};

const CATALOG: Record<string, ReasonInfo> = {
  HUMAN_APPROVED: { label: 'Approved by a reviewer', rule: 'A permitted exception was authorized after revalidation', tone: 'ok', humanApprovable: false },
  HUMAN_REJECTED: { label: 'Rejected by a reviewer', rule: 'A reviewer rejected this request', tone: 'block', humanApprovable: false },
  ALLOWED_VENDOR: {
    label: 'Vendor is authorized',
    rule: 'Vendor must be on the allowed list',
    tone: 'ok',
    humanApprovable: false,
  },
  UNKNOWN_VENDOR: {
    label: 'Vendor not authorized',
    rule: 'Vendor must be on the allowed list',
    tone: 'block',
    humanApprovable: false,
  },
  DUPLICATE_INVOICE: {
    label: 'Duplicate invoice',
    rule: 'Same vendor + invoice number (or same file) must not be paid twice',
    tone: 'block',
    humanApprovable: false,
  },
  POSSIBLE_DUPLICATE: {
    label: 'Possible duplicate',
    rule: 'Similar vendor, amount and date to an earlier invoice',
    tone: 'warn',
    humanApprovable: false,
  },
  AGREEMENT_MISMATCH: {
    label: 'Differs from agreement',
    rule: 'Amount, currency and frequency must match the vendor agreement (within tolerance)',
    tone: 'warn',
    humanApprovable: false,
  },
  MISSING_AGREEMENT: {
    label: 'No agreement on file',
    rule: 'An active agreement is required for this vendor',
    tone: 'warn',
    humanApprovable: false,
  },
  AMOUNT_ABOVE_AUTO_LIMIT: {
    label: 'Above automatic limit',
    rule: 'Amount must not exceed the automatic approval limit',
    tone: 'warn',
    humanApprovable: true,
  },
  AMOUNT_ABOVE_HARD_LIMIT: {
    label: 'Above absolute limit',
    rule: 'Amount must not exceed the absolute ceiling',
    tone: 'block',
    humanApprovable: false,
  },
  BUDGET_EXCEEDED: {
    label: 'Budget exceeded',
    rule: 'Remaining budget for the period must cover the amount',
    tone: 'block',
    humanApprovable: false,
  },
  MISSING_BUDGET: {
    label: 'No budget for this currency',
    rule: 'A budget must exist for the invoice currency',
    tone: 'block',
    humanApprovable: false,
  },
  INVALID_OR_MISSING_DATA: {
    label: 'Unreadable or missing data',
    rule: 'Vendor, amount, currency and due date must be extractable',
    tone: 'warn',
    humanApprovable: false,
  },
  NOT_AN_INVOICE: {
    label: 'Not an invoice',
    rule: 'Only invoices can enter payment authorization',
    tone: 'block',
    humanApprovable: false,
  },
  DOCUMENT_TYPE_UNCERTAIN: {
    label: 'Document type needs review',
    rule: 'A clear invoice document is required before authorization',
    tone: 'warn',
    humanApprovable: false,
  },
  DOCUMENT_TYPE: {
    label: 'Document type',
    rule: 'Only invoices can enter payment authorization',
    tone: 'info',
    humanApprovable: false,
  },
  INVALID_CURRENCY: {
    label: 'Unsupported currency',
    rule: 'Currency must be valid and have a configured budget',
    tone: 'block',
    humanApprovable: false,
  },
  AGENT_NOT_AUTHORIZED: {
    label: 'Agent not authorized',
    rule: 'Requesting agent must hold a valid credential',
    tone: 'block',
    humanApprovable: false,
  },
  AGENT_REVOKED: {
    label: 'Agent access revoked',
    rule: 'Revoked agents cannot request new spend',
    tone: 'block',
    humanApprovable: false,
  },
  HUMAN_APPROVAL_REQUIRED: {
    label: 'Needs a human decision',
    rule: 'Policy requires an owner/approver for this exception',
    tone: 'info',
    humanApprovable: true,
  },
  POLICY_ALLOWED: {
    label: 'All rules satisfied',
    rule: 'Every active rule passed',
    tone: 'ok',
    humanApprovable: false,
  },
  EXTRACTION: {
    label: 'Extraction & corroboration',
    rule: 'Critical fields must match across independent readings',
    tone: 'ok',
    humanApprovable: false,
  },
  DUPLICATE_HASH: {
    label: 'Cryptographic hash check',
    rule: 'Identical file content must not exist in history',
    tone: 'block',
    humanApprovable: false,
  },
  DUPLICATE_NUMBER: {
    label: 'Invoice number check',
    rule: 'Vendor must not submit the same invoice number twice',
    tone: 'block',
    humanApprovable: false,
  },
  VENDOR: {
    label: 'Vendor authorization',
    rule: 'Vendor must be approved under current policy',
    tone: 'ok',
    humanApprovable: false,
  },
  AGREEMENT: {
    label: 'Vendor agreement',
    rule: 'Amount, currency and concept must match agreed terms',
    tone: 'ok',
    humanApprovable: false,
  },
  AMOUNT_LIMIT: {
    label: 'Approval limit check',
    rule: 'Amount must stay within automatic approval limits',
    tone: 'ok',
    humanApprovable: true,
  },
  BUDGET: {
    label: 'Budget check',
    rule: 'Monthly budget must have enough room for this bill',
    tone: 'ok',
    humanApprovable: false,
  },
  INVOICE_DATES: {
    label: 'Invoice dates check',
    rule: 'Due date must be on or after invoice issuance',
    tone: 'warn',
    humanApprovable: false,
  },
};

export function humanize(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Translated at call time (module constants stay English). */
export function reasonInfo(code: string): ReasonInfo {
  const c = CATALOG[code];
  if (!c) {
    const h = humanize(code);
    return { label: h, rule: h, tone: 'info', humanApprovable: false };
  }
  return { ...c, label: t(c.label), rule: t(c.rule) };
}

/** Reasons a human "yes" can NEVER override, regardless of mandate config. Shown on the Rules page. */
export const HARD_STOP_REASONS = Object.entries(CATALOG)
  .filter(([code, v]) => v.tone === 'block' || v.label === 'Unreadable or missing data' || code === 'DOCUMENT_TYPE_UNCERTAIN')
  .map(([k]) => k);

/** Reasons the mandate editor may mark as human-approvable (§4.2). */
export const OVERRIDABLE_REASONS = ['AMOUNT_ABOVE_AUTO_LIMIT', 'AGREEMENT_MISMATCH', 'MISSING_AGREEMENT', 'POSSIBLE_DUPLICATE'] as const;

export const DECISION_LABEL: Record<Decision, string> = {
  APPROVE: 'Approved',
  BLOCK: 'Blocked',
  ESCALATE: 'Needs approval',
};

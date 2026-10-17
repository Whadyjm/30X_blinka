/**
 * MOCK ONLY — stand-in for the Worker's Policy Engine so the UI can be built and demoed
 * without a backend. It mirrors the *order* of §9.1 but is NOT the source of truth and is
 * never bundled in `live` mode (dynamic import). The real engine lives in packages/domain.
 */
import type { Agreement, ExtractedInvoice, FinanceMandate, InvoiceDetail, PolicyDecision, Vendor } from '@/contracts';

export type EngineContext = {
  mandate: FinanceMandate;
  vendors: Vendor[];
  agreements: Agreement[];
  /** Other invoices already in the system (for duplicate detection). */
  existing: Array<Pick<InvoiceDetail, 'id' | 'status' | 'extracted' | 'fileSha256'>>;
  budgetRemainingMinor: number;
  budgetCurrency: string;
  /** When true, the requesting agent was revoked. */
  agentRevoked?: boolean;
  nowIso: string;
};

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function mockEvaluate(x: ExtractedInvoice, ctx: EngineContext, policyVersion: number): PolicyDecision {
  const reasons: string[] = [];
  const facts: PolicyDecision['facts'] = { currency: x.currency ?? undefined, amountMinor: x.amountMinor ?? undefined };
  let block = false;
  let escalate = false;
  const b = () => (block = true);
  const e = () => (escalate = true);

  // 2. agent state (checked first so it is always explained)
  if (ctx.agentRevoked) {
    reasons.push('AGENT_REVOKED');
    b();
  }

  // 1. impossible / missing data → never auto-approve
  const missing =
    !x.vendorName || x.amountMinor == null || x.amountMinor <= 0 || !x.currency || !x.dueDate;
  if (missing) {
    reasons.push('INVALID_OR_MISSING_DATA');
    e();
  }
  if (x.currency && x.currency !== ctx.mandate.currency) {
    reasons.push('INVALID_CURRENCY');
    b();
  }

  const vendor = ctx.vendors.find((v) => norm(v.name) === norm(x.vendorName));

  // 3. duplicates
  const dup = ctx.existing.find(
    (o) =>
      o.status !== 'FAILED' &&
      o.extracted &&
      norm(o.extracted.vendorName) === norm(x.vendorName) &&
      x.invoiceNumber &&
      norm(o.extracted.invoiceNumber) === norm(x.invoiceNumber),
  );
  if (dup) {
    reasons.push('DUPLICATE_INVOICE');
    facts.duplicateOfInvoiceId = dup.id;
    b();
  } else {
    const maybe = ctx.existing.find(
      (o) =>
        o.status !== 'FAILED' &&
        o.extracted &&
        norm(o.extracted.vendorName) === norm(x.vendorName) &&
        o.extracted.amountMinor === x.amountMinor &&
        o.extracted.dueDate === x.dueDate,
    );
    if (maybe) {
      reasons.push('POSSIBLE_DUPLICATE');
      facts.duplicateOfInvoiceId = maybe.id;
      e();
    }
  }

  // 4. vendor
  if (ctx.mandate.requireAllowedVendor && x.vendorName) {
    facts.vendorAllowed = !!vendor?.allowed;
    if (!vendor?.allowed) {
      reasons.push('UNKNOWN_VENDOR');
      b();
    }
  }

  // 5. agreements
  if (ctx.mandate.requireAgreement && vendor?.allowed && x.amountMinor != null) {
    const ag = ctx.agreements.find((a) => a.vendorId === vendor.id && a.active && a.currency === x.currency);
    if (!ag) {
      reasons.push('MISSING_AGREEMENT');
      e();
    } else {
      facts.agreementAmountMinor = ag.amountMinor;
      if (Math.abs(x.amountMinor - ag.amountMinor) > ag.toleranceMinor) {
        reasons.push('AGREEMENT_MISMATCH');
        e();
      }
    }
  }

  // 6. hard limit
  facts.autoLimitMinor = ctx.mandate.automaticLimitMinor;
  facts.hardLimitMinor = ctx.mandate.hardLimitMinor;
  const overHard = x.amountMinor != null && x.amountMinor > ctx.mandate.hardLimitMinor;
  if (overHard) {
    reasons.push('AMOUNT_ABOVE_HARD_LIMIT');
    b();
  }

  // 7. budget
  facts.budgetRemainingMinor = ctx.budgetRemainingMinor;
  if (x.currency && x.currency === ctx.budgetCurrency && x.amountMinor != null && x.amountMinor > ctx.budgetRemainingMinor) {
    reasons.push('BUDGET_EXCEEDED');
    b();
  }

  // 8. auto limit
  if (!overHard && x.amountMinor != null && x.amountMinor > ctx.mandate.automaticLimitMinor) {
    reasons.push('AMOUNT_ABOVE_AUTO_LIMIT');
    e();
  }

  // 8b. is human approval even allowed for these reasons?
  const approvable = new Set(ctx.mandate.humanApprovableReasons ?? []);
  if (!block && escalate) {
    const allApprovable =
      ctx.mandate.humanApprovalEnabled && reasons.every((r) => approvable.has(r) || r === 'HUMAN_APPROVAL_REQUIRED');
    if (allApprovable) reasons.push('HUMAN_APPROVAL_REQUIRED');
  }

  const action = block ? 'BLOCK' : escalate ? 'ESCALATE' : 'APPROVE';
  if (action === 'APPROVE') reasons.push('ALLOWED_VENDOR', 'POLICY_ALLOWED');

  return {
    invoiceId: undefined,
    decision: action,
    status: action === 'APPROVE' ? 'APPROVED' : action === 'BLOCK' ? 'BLOCKED' : 'NEEDS_APPROVAL',
    policyVersion,
    reasons,
    facts,
    explanation: explain(action, reasons, x, ctx),
    needsHumanApproval: action === 'ESCALATE' && reasons.includes('HUMAN_APPROVAL_REQUIRED'),
    checkedAt: ctx.nowIso,
    trace: undefined,
    simulated: true,
  };
}

function money(minor: number | null | undefined, cur: string | null | undefined) {
  if (minor == null) return 'an unknown amount';
  const c = cur ?? 'USD';
  const s = (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c === 'USD' ? `$${s}` : `${s} ${c}`;
}

function explain(action: string, reasons: string[], x: ExtractedInvoice, ctx: EngineContext): string {
  const amt = money(x.amountMinor, x.currency);
  const vendor = x.vendorName ?? 'This vendor';
  if (action === 'APPROVE') {
    return `${vendor} is authorized, ${amt} matches its agreement and is within the automatic limit of ${money(ctx.mandate.automaticLimitMinor, ctx.mandate.currency)}, and the budget covers it. Approved.`;
  }
  const parts: string[] = [];
  if (reasons.includes('AGENT_REVOKED')) parts.push('the requesting agent’s access was revoked');
  if (reasons.includes('DUPLICATE_INVOICE')) parts.push('this invoice number was already submitted by the same vendor');
  if (reasons.includes('POSSIBLE_DUPLICATE')) parts.push('it looks similar to an earlier invoice');
  if (reasons.includes('UNKNOWN_VENDOR')) parts.push(`${vendor} is not on the authorized vendor list`);
  if (reasons.includes('INVALID_CURRENCY')) parts.push('the currency has no configured budget');
  if (reasons.includes('MISSING_AGREEMENT')) parts.push('there is no active agreement for this vendor');
  if (reasons.includes('AGREEMENT_MISMATCH')) parts.push(`${amt} differs from the agreed amount`);
  if (reasons.includes('AMOUNT_ABOVE_HARD_LIMIT')) parts.push(`${amt} exceeds the absolute limit of ${money(ctx.mandate.hardLimitMinor, ctx.mandate.currency)}`);
  if (reasons.includes('BUDGET_EXCEEDED')) parts.push(`only ${money(ctx.budgetRemainingMinor, ctx.budgetCurrency)} of budget remains`);
  if (reasons.includes('AMOUNT_ABOVE_AUTO_LIMIT')) parts.push(`${amt} is above the automatic limit of ${money(ctx.mandate.automaticLimitMinor, ctx.mandate.currency)}`);
  if (reasons.includes('INVALID_OR_MISSING_DATA')) parts.push('required fields could not be read from the document');
  const lead = action === 'BLOCK' ? 'Blocked' : 'Needs a human decision';
  const tail =
    action === 'ESCALATE' && !reasons.includes('HUMAN_APPROVAL_REQUIRED')
      ? ' Policy does not allow a human “yes” for this — fix the data or update the policy first.'
      : action === 'ESCALATE'
        ? ' Policy allows an owner or approver to review it.'
        : '';
  return `${lead}: ${parts.join('; ')}.${tail}`;
}

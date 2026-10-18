/** UI presentation models and mock-only/P1 schemas.
 * HTTP payloads are validated exclusively with @oli/contracts; api/view-model.ts
 * projects them into this existing presentation shape without deciding permissions. */
import { z } from 'zod';

/* ───────────────────────── primitives ───────────────────────── */

export const DecisionActionSchema = z.enum(['APPROVE', 'BLOCK', 'ESCALATE']);
export type Decision = z.infer<typeof DecisionActionSchema>;

export const InvoiceSourceSchema = z.enum(['HUMAN_UPLOAD', 'AGENT_REQUEST', 'TELEGRAM', 'EMAIL']);
export type InvoiceSource = z.infer<typeof InvoiceSourceSchema>;

export const RoleSchema = z.enum(['owner', 'approver']);
export type Role = z.infer<typeof RoleSchema>;

/** Safe integer in minor units (cents). */
export const MinorSchema = z.number().int().refine(Number.isSafeInteger, 'amount is not a safe integer');
/** ISO 4217 code, e.g. "USD". */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
/** YYYY-MM-DD */
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** ISO timestamp (UTC). Lenient on purpose: D1 may return "YYYY-MM-DD HH:MM:SS". */
export const TimestampSchema = z.string().min(8);

/** Processing lifecycle (§13) + business statuses used in the decision example. */
export const KNOWN_STATUSES = [
  'RECEIVED',
  'PARSING',
  'READY',
  'PROCESSING',
  'DECIDED',
  'FAILED',
  'APPROVED',
  'BLOCKED',
  'NEEDS_APPROVAL',
  'REJECTED',
] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

/** Reason codes from §8. Server may add more → schema stays `string`. */
export const KNOWN_REASON_CODES = [
  'ALLOWED_VENDOR',
  'UNKNOWN_VENDOR',
  'DUPLICATE_INVOICE',
  'POSSIBLE_DUPLICATE',
  'AGREEMENT_MISMATCH',
  'MISSING_AGREEMENT',
  'AMOUNT_ABOVE_AUTO_LIMIT',
  'AMOUNT_ABOVE_HARD_LIMIT',
  'BUDGET_EXCEEDED',
  'MISSING_BUDGET',
  'INVALID_OR_MISSING_DATA',
  'NOT_AN_INVOICE',
  'DOCUMENT_TYPE_UNCERTAIN',
  'INVALID_CURRENCY',
  'AGENT_NOT_AUTHORIZED',
  'AGENT_REVOKED',
  'HUMAN_APPROVAL_REQUIRED',
  'POLICY_ALLOWED',
] as const;
export type DecisionReasonCode = (typeof KNOWN_REASON_CODES)[number];

/* ───────────────────────── extraction ───────────────────────── */

export const ExtractedInvoiceSchema = z.object({
  vendorName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  amountMinor: MinorSchema.nullable(),
  currency: z.string().nullable(),
  issuedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  description: z.string().nullable(),
  servicePeriod: z.string().nullable().optional(),
  extractionWarnings: z.array(z.string()).default([]),
  evidence: z
    .array(z.object({ field: z.string(), source: z.string(), quote: z.string().optional() }))
    .default([]),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

/* ───────────────────────── decision ───────────────────────── */

/** One explainable step: data → rule → result → evidence. Optional from the server; the UI can derive a fallback. */
export const TraceStepSchema = z.object({
  rule: z.string(), // reason code or rule name
  field: z.string().optional(),
  observed: z.string().optional(),
  expected: z.string().optional(),
  result: z.enum(['PASS', 'FAIL', 'WARN', 'INFO']),
  evidence: z.string().optional(),
  policyVersion: z.number().int().optional(),
  checkedAt: TimestampSchema.optional(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

/** Facts the engine verified. Known keys are typed; extra keys are preserved. */
export const DecisionFactsSchema = z
  .object({
    amountMinor: MinorSchema.optional(),
    currency: z.string().optional(),
    autoLimitMinor: MinorSchema.optional(),
    hardLimitMinor: MinorSchema.optional(),
    vendorAllowed: z.boolean().optional(),
    agreementAmountMinor: MinorSchema.optional(),
    budgetRemainingMinor: MinorSchema.optional(),
    duplicateOfInvoiceId: z.string().optional(),
  })
  .catchall(z.unknown());
export type DecisionFacts = z.infer<typeof DecisionFactsSchema>;

/**
 * Two shapes exist in the brief for the same thing:
 *  §13 example:  { decision, policyVersion, reasons, facts, explanation, simulated, status }
 *  §8 type:      { action, reasons, humanExplanation, policyVersionId, checkedAt, needsHumanApproval }
 * We accept both and normalize to the §13 shape.
 */
const decisionRaw = z.object({
  id: z.string().optional(),
  invoiceId: z.string().optional(),
  decision: DecisionActionSchema.optional(),
  action: DecisionActionSchema.optional(),
  status: z.string().optional(),
  policyVersion: z.union([z.number(), z.string()]).optional(),
  policyVersionId: z.union([z.number(), z.string()]).optional(),
  reasons: z.array(z.string()).default([]),
  facts: DecisionFactsSchema.optional(),
  explanation: z.string().optional(),
  humanExplanation: z.string().optional(),
  needsHumanApproval: z.boolean().optional(),
  checkedAt: TimestampSchema.optional(),
  trace: z.array(TraceStepSchema).optional(),
  simulated: z.boolean().optional(),
});

export const PolicyDecisionSchema = decisionRaw.transform((d, ctx) => {
  const decision = d.decision ?? d.action;
  if (!decision) {
    ctx.addIssue({ code: 'custom', message: 'decision payload has neither "decision" nor "action"' });
    return z.NEVER;
  }
  return {
    ...(d.id ? { id: d.id } : {}),
    ...(d.policyVersionId ? { policyVersionId: d.policyVersionId } : {}),
    invoiceId: d.invoiceId,
    decision,
    status: d.status,
    policyVersion: d.policyVersion ?? d.policyVersionId,
    reasons: d.reasons,
    facts: d.facts ?? {},
    explanation: d.explanation ?? d.humanExplanation ?? '',
    needsHumanApproval: d.needsHumanApproval ?? decision === 'ESCALATE',
    checkedAt: d.checkedAt,
    trace: d.trace,
    // Fail-safe display flag: this product never moves real money.
    simulated: true as const,
  };
});
export type PolicyDecision = z.output<typeof PolicyDecisionSchema>;

/* ───────────────────────── approvals ───────────────────────── */

export const ApprovalStateSchema = z.string(); // PENDING | APPROVED | REJECTED | INVALIDATED | EXPIRED …
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED' | 'EXPIRED' | (string & {});

export const ApprovalSummarySchema = z.object({
  decisionId: z.string().optional(),
  policyVersionId: z.string().optional(),
  canDecide: z.boolean().optional(),
  id: z.string(),
  state: ApprovalStateSchema,
  reason: z.string().nullable().optional(),
  reviewerName: z.string().nullable().optional(),
  reviewerId: z.string().nullable().optional(),
  decidedAt: TimestampSchema.nullable().optional(),
  justification: z.string().nullable().optional(),
});
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;

/* ───────────────────────── invoices ───────────────────────── */

export const InvoiceSummarySchema = z.object({
  fileUrl: z.string().optional(),
  retryable: z.boolean().optional(),
  id: z.string(),
  source: InvoiceSourceSchema.default('HUMAN_UPLOAD'),
  requestingAgentName: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  status: z.string(),
  vendorName: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  amountMinor: MinorSchema.nullable().optional(),
  currency: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  receivedAt: TimestampSchema,
  decision: PolicyDecisionSchema.nullable().optional(),
  approval: ApprovalSummarySchema.nullable().optional(),
  failureReason: z.string().nullable().optional(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actorKind: z.string(),
  actorId: z.string().nullable().optional(),
  actorName: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const InvoiceDetailSchema = InvoiceSummarySchema.extend({
  extracted: ExtractedInvoiceSchema.nullable().optional(),
  fileSha256: z.string().nullable().optional(),
  /** Optional override of the file URL (mock mode uses blob URLs). Default: `${API_BASE}/invoices/:id/file`. */
  fileUrl: z.string().nullable().optional(),
  audit: z.array(AuditEventSchema).default([]),
  /** Earlier decisions for this invoice, newest first (append-only ledger). */
  decisionHistory: z.array(PolicyDecisionSchema).default([]),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;

/* ───────────────────────── mandate / rules ───────────────────────── */

export const FinanceMandateSchema = z.object({
  revision: z.number().int().optional(),
  basedOnPolicyVersionId: z.string().nullable().optional(),
  expectedRevision: z.number().int().nullable().optional(),
  version: z.number().int(),
  currency: CurrencySchema,
  automaticLimitMinor: MinorSchema,
  hardLimitMinor: MinorSchema,
  monthlyBudgetMinor: MinorSchema,
  requireAllowedVendor: z.boolean(),
  requireAgreement: z.boolean(),
  humanApprovalEnabled: z.boolean(),
  reviewAboveMinor: MinorSchema,
  processDaysBeforeDue: z.number().int().min(0),
  /** ASSUMPTION: which reason codes a human may override (§4.2 step 2). Hard prohibitions are never allowed here. */
  humanApprovableReasons: z.array(z.string()).optional(),
  /** Set by server. */
  id: z.string().optional(),
  status: z.string().optional(),
  createdAt: TimestampSchema.optional(),
  createdByName: z.string().nullable().optional(),
});
export type FinanceMandate = z.infer<typeof FinanceMandateSchema>;

/** What the editor sends. `version` is assigned by the server on activation. */
export const MandateDraftInputSchema = FinanceMandateSchema.omit({
  version: true,
  id: true,
  status: true,
  createdAt: true,
  createdByName: true,
});
export type MandateDraftInput = z.infer<typeof MandateDraftInputSchema>;

export const BudgetSnapshotSchema = z.object({
  periodKey: z.string(), // "2026-10"
  currency: z.string(),
  limitMinor: MinorSchema,
  reservedMinor: MinorSchema,
});
export type BudgetSnapshot = z.infer<typeof BudgetSnapshotSchema>;

/** GET /mandate. ASSUMPTION: server may return `{active, draft, budget}` or a bare active mandate. */
export const MandateStateSchema = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && !('active' in v) && !('draft' in v) && 'automaticLimitMinor' in v) {
      return { active: v, draft: null, budget: null };
    }
    return v;
  },
  z.object({
    active: FinanceMandateSchema.nullable(),
    draft: FinanceMandateSchema.nullable().optional().default(null),
    budget: BudgetSnapshotSchema.nullable().optional().default(null),
  }),
);
export type MandateState = z.output<typeof MandateStateSchema>;

export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  allowed: z.boolean(),
  externalRef: z.string().nullable().optional(),
});
export type Vendor = z.infer<typeof VendorSchema>;
export const VendorInputSchema = z.object({
  id: z.string().optional(), // ASSUMPTION: POST with id = update
  name: z.string().min(1).max(120),
  allowed: z.boolean(),
  externalRef: z.string().max(80).nullable().optional(),
});
export type VendorInput = z.infer<typeof VendorInputSchema>;

export const AGREEMENT_FREQUENCIES = ['ONE_TIME', 'MONTHLY'] as const;
export const AgreementSchema = z.object({
  id: z.string(),
  vendorId: z.string(),
  vendorName: z.string().nullable().optional(),
  currency: CurrencySchema,
  amountMinor: MinorSchema,
  toleranceMinor: MinorSchema.default(0),
  frequency: z.string(),
  concept: z.string().nullable().optional(),
  active: z.boolean(),
});
export type Agreement = z.infer<typeof AgreementSchema>;
export const AgreementInputSchema = z.object({
  id: z.string().optional(),
  vendorId: z.string(),
  currency: CurrencySchema,
  amountMinor: MinorSchema.positive(),
  toleranceMinor: MinorSchema.min(0),
  frequency: z.enum(AGREEMENT_FREQUENCIES),
  concept: z.string().max(200).nullable().optional(),
  active: z.boolean(),
});
export type AgreementInput = z.infer<typeof AgreementInputSchema>;

/* ───────────────────────── approvals queue ───────────────────────── */

export const ApprovalRequestSchema = z.object({
  decisionId: z.string().optional(),
  policyVersionId: z.string().optional(),
  id: z.string(),
  invoiceId: z.string(),
  state: ApprovalStateSchema,
  reason: z.string().nullable().optional(),
  reasons: z.array(z.string()).default([]),
  createdAt: TimestampSchema,
  /** Server-computed: can THIS user approve THIS item right now? UI only reflects it. */
  canDecide: z.boolean().optional(),
  /** Why not (e.g. "Hard limit exceeded — policy change required"). */
  cannotDecideReason: z.string().nullable().optional(),
  invoice: InvoiceSummarySchema.optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionInputSchema = z.object({
  expectedDecisionId: z.string().optional(),
  expectedPolicyVersionId: z.string().optional(),
  decision: z.enum(['APPROVE', 'REJECT']),
  justification: z.string().min(3).max(1000),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;

/* ───────────────────────── evaluation ───────────────────────── */

export const EvaluationCaseSchema = z.object({
  id: z.string(),
  group: z.string(),
  title: z.string().optional(),
  expected: z.array(DecisionActionSchema).or(DecisionActionSchema).transform((v) => (Array.isArray(v) ? v : [v])),
  actual: DecisionActionSchema,
  correct: z.boolean(),
  unsafeApproval: z.boolean().default(false),
  reasons: z.array(z.string()).default([]),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

export const EvaluationSummarySchema = z.object({
  runAt: TimestampSchema,
  datasetVersion: z.string(),
  totalCases: z.number().int(),
  unsafeApprovals: z.number().int(),
  /** 0..1 */
  decisionAccuracy: z.number().min(0).max(1),
  correctAutonomy: z.number().min(0).max(1),
  explanationCoverage: z.number().min(0).max(1),
  groups: z
    .array(z.object({ group: z.string(), total: z.number().int(), correct: z.number().int() }))
    .default([]),
  cases: z.array(EvaluationCaseSchema).default([]),
});
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;

/* ───────────────────────── session / org ───────────────────────── */

export const MeSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable().optional() }),
  org: z
    .object({ id: z.string(), name: z.string(), defaultCurrency: z.string() })
    .nullable(),
  role: RoleSchema.nullable(),
  /** True when this is the public fictitious demo org. */
  demo: z.boolean().optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const LoginInputSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const CreateOrgInputSchema = z.object({
  name: z.string().min(2).max(80),
  defaultCurrency: CurrencySchema,
  ownerName: z.string().min(2).max(80),
});
export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;

/* ───────────────────────── agent access (P1) ───────────────────────── */

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).default([]),
  monthlyRequestLimitMinor: MinorSchema.nullable().optional(),
  createdAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable().optional(),
  lastUsedAt: TimestampSchema.nullable().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;
export const CreatedAgentSchema = AgentSchema.extend({ apiKey: z.string() }); // shown ONCE
export type CreatedAgent = z.infer<typeof CreatedAgentSchema>;

/* ───────────────────────── clearance (P2) ───────────────────────── */

export const ClearanceVerificationSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED', 'INVALID']),
  vendorName: z.string().nullable().optional(),
  amountMinor: MinorSchema.nullable().optional(),
  currency: z.string().nullable().optional(),
  issuedAt: TimestampSchema.nullable().optional(),
  expiresAt: TimestampSchema.nullable().optional(),
  simulated: z.boolean().optional(),
});
export type ClearanceVerification = z.infer<typeof ClearanceVerificationSchema>;

/* ───────────────────────── errors & lists ───────────────────────── */

/** ASSUMPTION (§13 "errors estandarizados"): { error: { code, message, details?, requestId? } } */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

/** Lists may come back as a bare array, `{items}` or `{data}`. All accepted. */
export function listOf<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.items)) return o.items;
        if (Array.isArray(o.data)) return o.data;
      }
      return v;
    },
    z.array(item),
  ) as unknown as z.ZodType<z.output<T>[], unknown>;
}

export const HealthSchema = z.object({ ok: z.boolean(), service: z.string().optional() });

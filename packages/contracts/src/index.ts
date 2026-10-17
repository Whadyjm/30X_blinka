import { z } from 'zod';

export const IdSchema = z.string().trim().min(1);
export const CurrencySchema = z.currencyCode();
export const DateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime();
export const PeriodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const MinorUnitsSchema = z.int().min(0);
export const PositiveMinorUnitsSchema = MinorUnitsSchema.min(1);
const NameSchema = z.string().trim().min(1);

export const DecisionActionSchema = z.enum(['APPROVE', 'BLOCK', 'ESCALATE']);
export const DocumentTypeSchema = z.enum([
  'INVOICE', 'PAYMENT_RECEIPT', 'DELIVERY_NOTE', 'QUOTE', 'CREDIT_NOTE', 'OTHER', 'UNKNOWN',
]);
export const InvoiceStatusSchema = z.enum([
  'RECEIVED', 'PARSING', 'READY', 'PROCESSING', 'DECIDED', 'FAILED',
]);
export const ReevaluateInvoiceSchema = z.strictObject({
  expectedDecisionId: IdSchema,
  expectedPolicyVersionId: IdSchema,
});
export const RoleSchema = z.enum(['OWNER', 'APPROVER']);
export const ApprovalStateSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED']);
export const PaginationSchema = z.strictObject({
  page: z.int().min(1),
  pageSize: z.int().min(1).max(100),
  total: z.int().min(0),
});
export const SessionSchema = z.strictObject({
  user: z.strictObject({ id: IdSchema, name: NameSchema, email: z.email() }),
  organization: z.strictObject({
    id: IdSchema,
    name: NameSchema,
    defaultCurrency: CurrencySchema,
    timezone: z.string().refine((value) => {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
      catch { return false; }
    }, 'Zona horaria inválida.'),
  }),
  role: RoleSchema,
  csrfToken: z.string().min(1),
});
export const LoginInputSchema = z.strictObject({
  email: z.union([z.email(), z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/)]),
  password: z.string().min(1),
});

export const CreateVendorSchema = z.strictObject({
  name: NameSchema,
  allowed: z.boolean(),
  externalRef: z.string().trim().min(1).nullable(),
});
export const UpdateVendorSchema = CreateVendorSchema.partial().refine(
  (input) => Object.keys(input).length > 0, 'Indica al menos un campo.',
);
export const VendorSchema = z.strictObject({
  id: IdSchema, ...CreateVendorSchema.shape, createdAt: TimestampSchema,
});
export const CreateAgreementSchema = z.strictObject({
  vendorId: IdSchema,
  currency: CurrencySchema,
  amountMinor: PositiveMinorUnitsSchema,
  toleranceMinor: MinorUnitsSchema,
  frequency: z.enum(['ONE_TIME', 'MONTHLY']),
  concept: NameSchema,
  active: z.boolean(),
});
export const UpdateAgreementSchema = CreateAgreementSchema.partial().refine(
  (input) => Object.keys(input).length > 0, 'Indica al menos un campo.',
);
export const AgreementSchema = z.strictObject({
  id: IdSchema, ...CreateAgreementSchema.shape, createdAt: TimestampSchema,
});
export const ScopedDelegationSchema = z.strictObject({
  vendorId: IdSchema,
  agreementId: IdSchema,
  currency: CurrencySchema,
  maxAmountMinor: PositiveMinorUnitsSchema,
  validFrom: DateSchema,
  validUntil: DateSchema,
  maxPerPeriod: z.int().min(1),
}).refine((rule) => rule.validFrom <= rule.validUntil, {
  path: ['validUntil'], message: 'Debe ser igual o posterior al inicio.',
});
export const MandateRulesSchema = z.strictObject({
  currency: CurrencySchema,
  automaticLimitMinor: MinorUnitsSchema,
  hardLimitMinor: MinorUnitsSchema,
  monthlyBudgetMinor: MinorUnitsSchema,
  requireAllowedVendor: z.boolean(),
  requireAgreement: z.boolean(),
  humanApprovalEnabled: z.boolean(),
  reviewAboveMinor: MinorUnitsSchema,
  processDaysBeforeDue: z.int().min(0),
  scopedDelegations: z.array(ScopedDelegationSchema),
}).superRefine((rules, ctx) => {
  if (rules.automaticLimitMinor > rules.hardLimitMinor) {
    ctx.addIssue({ code: 'custom', path: ['hardLimitMinor'], message: 'No puede ser menor al límite automático.' });
  }
  if (rules.reviewAboveMinor > rules.automaticLimitMinor) {
    ctx.addIssue({ code: 'custom', path: ['reviewAboveMinor'], message: 'No puede superar el límite automático.' });
  }
  rules.scopedDelegations.forEach((rule, index) => {
    if (rule.maxAmountMinor > rules.hardLimitMinor) {
      ctx.addIssue({ code: 'custom', path: ['scopedDelegations', index, 'maxAmountMinor'], message: 'No puede superar el techo absoluto.' });
    }
    if (rule.currency !== rules.currency) {
      ctx.addIssue({ code: 'custom', path: ['scopedDelegations', index, 'currency'], message: 'Debe coincidir con la moneda del mandato.' });
    }
  });
});

// P0 no activa programación ni delegaciones mientras esos servicios no existan.
const P0MandateRulesSchema = MandateRulesSchema.refine(
  (rules) => rules.processDaysBeforeDue === 0 && rules.scopedDelegations.length === 0,
  'Programación y delegaciones todavía no están disponibles en P0.',
);
export const SaveMandateDraftSchema = z.strictObject({
  expectedRevision: z.int().min(1).nullable(),
  basedOnPolicyVersionId: IdSchema.nullable(),
  rules: P0MandateRulesSchema,
});
export const ActivateMandateSchema = z.strictObject({
  draftId: IdSchema,
  expectedRevision: z.int().min(1),
  expectedActivePolicyVersionId: IdSchema.nullable(),
  confirmed: z.literal(true),
});
export const PolicyVersionSchema = z.strictObject({
  id: IdSchema,
  version: z.int().min(1),
  status: z.enum(['ACTIVE', 'SUPERSEDED']),
  rules: MandateRulesSchema,
  activatedAt: TimestampSchema,
  activatedBy: IdSchema,
});
export const MandateDraftSchema = z.strictObject({
  id: IdSchema,
  revision: z.int().min(1),
  basedOnPolicyVersionId: IdSchema.nullable(),
  rules: MandateRulesSchema,
  updatedAt: TimestampSchema,
});
export const BudgetPeriodSchema = z.strictObject({
  id: IdSchema,
  currency: CurrencySchema,
  periodKey: PeriodKeySchema,
  limitMinor: MinorUnitsSchema,
  reservedMinor: MinorUnitsSchema,
  availableMinor: MinorUnitsSchema,
}).refine((budget) => budget.reservedMinor <= budget.limitMinor
  && budget.availableMinor === budget.limitMinor - budget.reservedMinor,
'La reserva y el disponible deben respetar el límite.');

export const ExtractedInvoiceSchema = z.strictObject({
  vendorName: NameSchema.nullable(),
  invoiceNumber: NameSchema.nullable(),
  amountMinor: PositiveMinorUnitsSchema.nullable(),
  currency: CurrencySchema.nullable(),
  issuedAt: DateSchema.nullable(),
  dueDate: DateSchema.nullable(),
  servicePeriod: PeriodKeySchema.nullable(),
  description: NameSchema.nullable(),
  extractionWarnings: z.array(z.string()),
  evidence: z.array(z.strictObject({ field: NameSchema, source: NameSchema, quote: z.string().optional() })),
});
export const DecisionReasonCodeSchema = z.enum([
  'ALLOWED_VENDOR', 'UNKNOWN_VENDOR', 'DUPLICATE_INVOICE', 'POSSIBLE_DUPLICATE',
  'AGREEMENT_MISMATCH', 'MISSING_AGREEMENT', 'AMOUNT_ABOVE_AUTO_LIMIT',
  'AMOUNT_ABOVE_HARD_LIMIT', 'BUDGET_EXCEEDED', 'MISSING_BUDGET',
  'INVALID_OR_MISSING_DATA', 'INVALID_CURRENCY', 'HUMAN_APPROVAL_REQUIRED',
  'POLICY_ALLOWED', 'HUMAN_APPROVED', 'HUMAN_REJECTED',
  'NOT_AN_INVOICE', 'DOCUMENT_TYPE_UNCERTAIN',
]);
export const PolicyDecisionSchema = z.strictObject({
  id: IdSchema,
  invoiceId: IdSchema,
  action: DecisionActionSchema,
  reasons: z.array(DecisionReasonCodeSchema).min(1),
  humanExplanation: NameSchema,
  policyVersionId: IdSchema,
  policyVersion: z.int().min(1),
  checkedAt: TimestampSchema,
  needsHumanApproval: z.boolean(),
  actor: z.strictObject({ kind: z.enum(['SYSTEM', 'HUMAN']), userId: IdSchema.nullable() }),
  facts: z.strictObject({
    amountMinor: PositiveMinorUnitsSchema.nullable(),
    currency: CurrencySchema.nullable(),
    automaticLimitMinor: MinorUnitsSchema,
    hardLimitMinor: MinorUnitsSchema,
    budgetAvailableBeforeMinor: MinorUnitsSchema.nullable(),
    vendorAllowed: z.boolean().nullable(),
    agreementId: IdSchema.nullable(),
  }),
  trace: z.array(z.strictObject({
    rule: NameSchema,
    outcome: z.enum(['PASS', 'BLOCK', 'ESCALATE']),
    explanation: NameSchema,
    evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })).min(1),
  simulated: z.literal(true),
});
export const ApprovalRequestSchema = z.strictObject({
  id: IdSchema,
  invoiceId: IdSchema,
  decisionId: IdSchema,
  policyVersionId: IdSchema,
  state: ApprovalStateSchema,
  reason: NameSchema,
  canApprove: z.boolean(),
  reviewerId: IdSchema.nullable(),
  reviewComment: z.string().nullable(),
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
});
export const ReviewApprovalSchema = z.strictObject({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().min(1).max(1000),
  expectedDecisionId: IdSchema,
  expectedPolicyVersionId: IdSchema,
});

export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;
export const TelegramIntegrationSchema = z.strictObject({
  available: z.boolean(),
  connection: z.strictObject({ id: IdSchema, displayName: z.string(), connectedAt: TimestampSchema }).nullable(),
});
export const TelegramLinkSchema = z.strictObject({
  url: z.string().regex(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+$/),
  expiresAt: TimestampSchema,
});
export type TelegramIntegration = z.infer<typeof TelegramIntegrationSchema>;
export type TelegramLink = z.infer<typeof TelegramLinkSchema>;
export const InvoiceMimeTypeSchema = z.enum(['application/pdf', 'image/png', 'image/jpeg']);
export const UploadFileMetadataSchema = z.strictObject({
  name: NameSchema,
  mimeType: InvoiceMimeTypeSchema,
  sizeBytes: z.int().min(1).max(MAX_INVOICE_BYTES),
});
export const InvoiceSchema = z.strictObject({
  id: IdSchema,
  status: InvoiceStatusSchema,
  source: z.enum(['HUMAN_UPLOAD', 'TELEGRAM', 'EMAIL']),
  file: UploadFileMetadataSchema.extend({
    url: z.string().regex(/^\/api\/v1\/invoices\/[^/?#]+\/file$/),
  }),
  vendorId: IdSchema.nullable(),
  vendorName: NameSchema.nullable(),
  agreementId: IdSchema.nullable(),
  invoiceNumber: NameSchema.nullable(),
  amountMinor: PositiveMinorUnitsSchema.nullable(),
  currency: CurrencySchema.nullable(),
  issuedAt: DateSchema.nullable(),
  dueDate: DateSchema.nullable(),
  servicePeriod: PeriodKeySchema.nullable(),
  description: NameSchema.nullable(),
  extractionWarnings: z.array(z.string()),
  latestDecision: PolicyDecisionSchema.nullable(),
  approvalRequest: ApprovalRequestSchema.nullable(),
  processingError: z.strictObject({ code: NameSchema, message: NameSchema, retryable: z.boolean() }).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const InvoiceDetailSchema = InvoiceSchema.extend({
  extraction: ExtractedInvoiceSchema.nullable(),
  decisions: z.array(PolicyDecisionSchema),
});

// Query strings usan conversión explícita: Boolean('false') sería true.
const QueryPageSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.int().min(1));
const PaginationQueryShape = {
  page: QueryPageSchema.default(1),
  pageSize: QueryPageSchema.pipe(z.int().max(100)).default(20),
};
export const PaginationQuerySchema = z.strictObject(PaginationQueryShape);
export const InvoiceQuerySchema = z.strictObject({
  ...PaginationQueryShape,
  status: InvoiceStatusSchema.optional(),
  action: DecisionActionSchema.optional(),
  vendorId: IdSchema.optional(),
  needsHumanApproval: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
export const AgreementQuerySchema = z.strictObject({ ...PaginationQueryShape, vendorId: IdSchema.optional() });
export const ApprovalQuerySchema = z.strictObject({ ...PaginationQueryShape, state: ApprovalStateSchema.default('PENDING') });
export const BudgetQuerySchema = z.strictObject({ periodKey: PeriodKeySchema.optional() });
export const IdempotencyKeySchema = z.uuid();

export const DashboardSchema = z.strictObject({
  counts: z.strictObject({
    total: z.int().min(0), approved: z.int().min(0), blocked: z.int().min(0),
    escalated: z.int().min(0), needsHumanApproval: z.int().min(0),
    processing: z.int().min(0), failed: z.int().min(0),
  }),
  budgets: z.array(BudgetPeriodSchema),
  upcoming: z.array(InvoiceSchema).max(5),
  recentDecisions: z.array(PolicyDecisionSchema).max(10),
  generatedAt: TimestampSchema,
  simulated: z.literal(true),
});
export const EvaluationSummarySchema = z.strictObject({
  datasetVersion: NameSchema,
  evaluatedAt: TimestampSchema,
  totalCases: z.int().min(1),
  correctDecisions: z.int().min(0),
  unsafeApprovals: z.int().min(0),
  correctAutonomousCases: z.int().min(0),
  explainedDecisions: z.int().min(0),
  decisionAccuracy: z.number().min(0).max(1),
  correctAutonomy: z.number().min(0).max(1),
  explanationCoverage: z.number().min(0).max(1),
});
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: NameSchema,
    message: NameSchema,
    fieldErrors: z.record(z.string(), z.array(z.string())),
    requestId: IdSchema,
  }),
});

export type DecisionAction = z.infer<typeof DecisionActionSchema>;
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;
export type DecisionReasonCode = z.infer<typeof DecisionReasonCodeSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type Page<T> = { data: T[]; pagination: Pagination };
export type Envelope<T> = { data: T };
export type Vendor = z.infer<typeof VendorSchema>;
export type Agreement = z.infer<typeof AgreementSchema>;
export type ScopedDelegation = z.infer<typeof ScopedDelegationSchema>;
export type MandateRules = z.infer<typeof MandateRulesSchema>;
export type PolicyVersion = z.infer<typeof PolicyVersionSchema>;
export type MandateDraft = z.infer<typeof MandateDraftSchema>;
export type SaveMandateDraft = z.infer<typeof SaveMandateDraftSchema>;
export type ActivateMandate = z.infer<typeof ActivateMandateSchema>;
export type BudgetPeriod = z.infer<typeof BudgetPeriodSchema>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ReviewApproval = z.infer<typeof ReviewApprovalSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

const CriticalExtractionFields = ['vendorName', 'amountMinor', 'currency', 'dueDate'] as const;
const CorroboratingReadSchema = z.strictObject({
  documentSha256: z.hash('sha256'),
  readId: IdSchema,
  method: z.enum(['PDF_TEXT', 'OCR']),
  fields: ExtractedInvoiceSchema.pick({ vendorName: true, amountMinor: true, currency: true, dueDate: true }),
});

export type ExtractionCheckIssue = {
  code: 'INVALID_EXTRACTION' | 'MISSING_CRITICAL_FIELD' | 'EXTRACTION_WARNING'
    | 'INVALID_SOURCE' | 'CORROBORATION_REQUIRED' | 'SOURCE_MISMATCH'
    | 'SAME_READ' | 'FIELD_MISMATCH';
  field: typeof CriticalExtractionFields[number] | null;
};
export type ExtractionCheck = {
  status: 'CROSS_CHECKED' | 'REVIEW_REQUIRED';
  extraction: ExtractedInvoice | null;
  issues: ExtractionCheckIssue[];
};

/**
 * Backend-only inputs: IDs, hash and corroboration must come from the document adapters,
 * never the browser or the model's JSON. CROSS_CHECKED means agreement, not truth or approval.
 */
export function checkExtraction(input: {
  documentSha256: string;
  primaryReadId: string;
  candidate: unknown;
  corroboration: unknown;
}): ExtractionCheck {
  const parsed = ExtractedInvoiceSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return { status: 'REVIEW_REQUIRED', extraction: null, issues: [{ code: 'INVALID_EXTRACTION', field: null }] };
  }
  const extraction = parsed.data;
  const issues: ExtractionCheckIssue[] = [];
  for (const field of CriticalExtractionFields) {
    if (extraction[field] === null) issues.push({ code: 'MISSING_CRITICAL_FIELD', field });
  }
  if (extraction.extractionWarnings.length > 0) issues.push({ code: 'EXTRACTION_WARNING', field: null });
  const primaryReadId = IdSchema.safeParse(input.primaryReadId);
  if (!z.hash('sha256').safeParse(input.documentSha256).success || !primaryReadId.success) {
    issues.push({ code: 'INVALID_SOURCE', field: null });
  }
  const corroboration = CorroboratingReadSchema.safeParse(input.corroboration);
  if (!corroboration.success) {
    issues.push({ code: 'CORROBORATION_REQUIRED', field: null });
  } else {
    const source = corroboration.data;
    if (source.documentSha256 !== input.documentSha256) issues.push({ code: 'SOURCE_MISMATCH', field: null });
    if (primaryReadId.success && source.readId === primaryReadId.data) issues.push({ code: 'SAME_READ', field: null });
    for (const field of CriticalExtractionFields) {
      const normalize = (value: string | number | null) => typeof value === 'string' && field === 'vendorName'
        ? value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() : value;
      if (source.fields[field] === null || normalize(extraction[field]) !== normalize(source.fields[field])) {
        issues.push({ code: 'FIELD_MISMATCH', field });
      }
    }
  }
  return { status: issues.length === 0 ? 'CROSS_CHECKED' : 'REVIEW_REQUIRED', extraction, issues };
}

// Conversational v1: the model may prepare actions; only authenticated UI confirmation executes them.
const ChatIdSchema = z.string().min(1).max(100);
const ChatVendorInputSchema = CreateVendorSchema.extend({ name: NameSchema.max(200), externalRef: z.string().trim().min(1).max(200).nullable() });
const ChatAgreementInputSchema = CreateAgreementSchema.extend({ concept: NameSchema.max(300) });
export const ChatActionInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CREATE_VENDOR'), data: ChatVendorInputSchema }),
  z.strictObject({ kind: z.literal('UPDATE_VENDOR'), targetId: ChatIdSchema, data: ChatVendorInputSchema.partial().refine(v => Object.keys(v).length > 0) }),
  z.strictObject({ kind: z.literal('CREATE_AGREEMENT'), data: ChatAgreementInputSchema }),
  z.strictObject({ kind: z.literal('UPDATE_AGREEMENT'), targetId: ChatIdSchema, data: ChatAgreementInputSchema.partial().refine(v => Object.keys(v).length > 0) }),
  z.strictObject({ kind: z.literal('ONBOARD_INVOICE_VENDOR'), invoiceId: ChatIdSchema,
    expectedDecisionId: ChatIdSchema, vendor: ChatVendorInputSchema,
    agreement: ChatAgreementInputSchema.omit({ vendorId: true }).nullable() }),
  z.strictObject({ kind: z.literal('RESUME_INVOICE'), invoiceId: ChatIdSchema, expectedDecisionId: ChatIdSchema }),
]);
export const ChatActionSchema = z.strictObject({
  id: ChatIdSchema, proposal: ChatActionInputSchema,
  before: z.union([VendorSchema, AgreementSchema, z.null()]),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED']),
  createdAt: TimestampSchema, expiresAt: TimestampSchema,
});
export const ChatMessageInputSchema = z.strictObject({
  conversationId: ChatIdSchema.nullable(), text: z.string().trim().max(4000),
  invoiceIds: z.array(ChatIdSchema).max(4),
}).refine(v => v.text.length > 0 || v.invoiceIds.length > 0, 'Escribe un mensaje o adjunta una factura.');
export const ChatPeriodSchema = z.union([PeriodKeySchema, z.enum(['CURRENT_MONTH', 'PREVIOUS_MONTH'])]);
export const ChatToolInputSchemas = {
  list_invoices: z.strictObject({ action: DecisionActionSchema.optional() }),
  inspect_invoice: z.strictObject({ invoiceId: ChatIdSchema }),
  list_vendors: z.strictObject({}),
  list_agreements: z.strictObject({ vendorId: ChatIdSchema.optional() }),
  get_budget: z.strictObject({ period: ChatPeriodSchema }),
  summarize_invoices: z.strictObject({ period: ChatPeriodSchema, query: z.string().trim().min(1).max(100).nullable() }),
  prepare_change: z.strictObject({ proposal: ChatActionInputSchema }),
};
export const ChatToolParameters = Object.fromEntries(Object.entries(ChatToolInputSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
export const InvoiceIntakeSchema = z.strictObject({
  status: z.enum(['PROCESSING', 'FAILED', 'EXTRACTION_REVIEW', 'UNKNOWN_VENDOR', 'DISALLOWED_VENDOR', 'AMBIGUOUS_VENDOR', 'KNOWN_VENDOR']),
  canOnboard: z.boolean(), canResume: z.boolean(), expectedDecisionId: ChatIdSchema.nullable(),
  suggestedVendorName: z.string().nullable(),
  suggestedAgreement: z.strictObject({ currency: CurrencySchema.nullable(), amountMinor: PositiveMinorUnitsSchema.nullable(),
    concept: z.string().nullable(), servicePeriod: PeriodKeySchema.nullable() }).nullable(),
});
export const ChatCardSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('INVOICE'), invoice: InvoiceDetailSchema, intake: InvoiceIntakeSchema }),
  z.strictObject({ type: z.literal('INVOICES'), invoices: z.array(InvoiceSchema).max(20), truncated: z.boolean() }),
  z.strictObject({ type: z.literal('VENDORS'), vendors: z.array(VendorSchema).max(20), truncated: z.boolean() }),
  z.strictObject({ type: z.literal('AGREEMENTS'), agreements: z.array(AgreementSchema).max(20), truncated: z.boolean() }),
  z.strictObject({ type: z.literal('BUDGET'), periodKey: PeriodKeySchema, budgets: z.array(BudgetPeriodSchema) }),
  z.strictObject({ type: z.literal('SPEND'), periodKey: PeriodKeySchema, query: z.string().nullable(),
    periodBasis: z.literal('SERVICE_PERIOD_OR_ISSUE_DATE'), amountBasis: z.literal('EXTRACTED_AMOUNTS_NOT_PAYMENTS'), totals: z.array(z.strictObject({
      currency: CurrencySchema, count: MinorUnitsSchema, invoicedMinor: MinorUnitsSchema,
      approvedMinor: MinorUnitsSchema, blockedMinor: MinorUnitsSchema,
    })) }),
]);
export const ChatReplySchema = z.strictObject({
  conversationId: ChatIdSchema, turnId: ChatIdSchema, text: z.string().max(8000),
  cards: z.array(ChatCardSchema).max(12), actions: z.array(ChatActionSchema).max(4),
  createdAt: TimestampSchema, model: z.literal('deepseek/deepseek-v4.1-flash'),
});
export const ConfirmChatActionSchema = z.strictObject({ confirmed: z.literal(true) });
export const ChatActionResultSchema = z.strictObject({ action: ChatActionSchema,
  vendor: VendorSchema.nullable(), agreement: AgreementSchema.nullable(), invoice: InvoiceDetailSchema.nullable() });
export const ChatHistorySchema = z.strictObject({ id: ChatIdSchema,
  turns: z.array(z.strictObject({ id: ChatIdSchema, text: z.string(), invoiceIds: z.array(ChatIdSchema),
    state: z.enum(['PROCESSING', 'COMPLETED', 'FAILED']), reply: ChatReplySchema.nullable(), errorCode: z.string().nullable(), createdAt: TimestampSchema })).max(20),
});
export const ChatConversationsSchema = z.array(z.strictObject({ id: ChatIdSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema })).max(20);
export type ChatReply = z.infer<typeof ChatReplySchema>;
export type ChatAction = z.infer<typeof ChatActionSchema>;
export type ChatActionInput = z.infer<typeof ChatActionInputSchema>;
export type ChatCard = z.infer<typeof ChatCardSchema>;
export type ChatActionResult = z.infer<typeof ChatActionResultSchema>;

export const EmailIntegrationSchema = z.strictObject({
  available: z.boolean(),
  mailbox: z.strictObject({ address: z.email(), enabled: z.boolean(), createdAt: TimestampSchema }).nullable(),
});
export const InboxMessageSchema = z.strictObject({
  id: IdSchema, sender: z.string().max(254), subject: z.string().max(200), receivedAt: TimestampSchema,
  state: z.enum(['RECEIVED','WAITING','COMPLETED','NO_DOCUMENT','FAILED']),
  readAt: TimestampSchema.nullable(), summary: z.string(),
  attachments: z.array(z.strictObject({ id: IdSchema, name: z.string(), invoiceId: IdSchema.nullable(),
    status: InvoiceStatusSchema.nullable(), decision: DecisionActionSchema.nullable(), explanation: z.string().nullable() })).max(4),
});
export const InboxSchema = z.strictObject({ messages: z.array(InboxMessageSchema).max(50), unreadCount: MinorUnitsSchema });
export type EmailIntegration = z.infer<typeof EmailIntegrationSchema>;
export type InboxMessage = z.infer<typeof InboxMessageSchema>;
export type Inbox = z.infer<typeof InboxSchema>;

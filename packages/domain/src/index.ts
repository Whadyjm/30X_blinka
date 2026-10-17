import { z } from 'zod';
import {
  AgreementSchema, BudgetPeriodSchema, ExtractedInvoiceSchema, IdSchema, PeriodKeySchema,
  PolicyDecisionSchema, PolicyVersionSchema, TimestampSchema, VendorSchema, checkExtraction,
} from '@oli/contracts';
import type { DecisionAction, DecisionReasonCode, PolicyDecision } from '@oli/contracts';

export const PolicyInvoiceSchema = z.strictObject({
  id: IdSchema,
  documentSha256: z.hash('sha256'),
  primaryReadId: IdSchema,
  extraction: z.unknown(),
  corroboration: z.unknown(),
  // A document reference is a lookup hint, never authorization or a trusted vendor ID.
  agreementReference: IdSchema.nullable(),
});

export const PriorInvoiceSchema = z.strictObject({
  id: IdSchema,
  documentSha256: z.hash('sha256'),
  vendorId: IdSchema.nullable(),
  agreementId: IdSchema.nullable(),
  extraction: ExtractedInvoiceSchema,
  reservationActive: z.boolean(),
});

export const PolicyContextSchema = z.strictObject({
  organizationId: IdSchema,
  decisionId: IdSchema,
  checkedAt: TimestampSchema,
  // Selected by the backend using the organization's budget period, not a PDF's date.
  budgetPeriodKey: PeriodKeySchema,
  policy: PolicyVersionSchema,
  vendors: z.array(VendorSchema),
  agreements: z.array(AgreementSchema),
  budget: BudgetPeriodSchema.nullable(),
  priorInvoices: z.array(PriorInvoiceSchema),
});

export type PolicyInvoice = z.infer<typeof PolicyInvoiceSchema>;
export type PolicyContext = z.infer<typeof PolicyContextSchema>;
export type PolicyEvaluation = {
  candidate: PolicyDecision;
  vendorId: string | null;
  agreementId: string | null;
  budgetPeriodId: string | null;
  requiresBudgetReservation: boolean;
};

export function normalizeInvoiceNumber(value: string | null): string | null {
  return value?.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') || null;
}

function normalizeText(value: string | null): string | null {
  return value?.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() || null;
}

/**
 * Pure P0 evaluation over a backend-owned, tenant-scoped snapshot. Throws for invalid
 * configuration; never writes or grants payment authority. APPROVE is only a candidate
 * until the service revalidates and commits it with D1's atomic reservation.
 */
export function evaluateInvoice(rawInvoice: PolicyInvoice, rawContext: PolicyContext): PolicyEvaluation {
  const invoice = PolicyInvoiceSchema.parse(rawInvoice);
  const context = PolicyContextSchema.parse(rawContext);
  const { policy, budget } = context;
  const rules = policy.rules;
  if (policy.status !== 'ACTIVE' || Date.parse(policy.activatedAt) > Date.parse(context.checkedAt)) throw new Error('POLICY_NOT_ACTIVE');
  if (rules.processDaysBeforeDue !== 0 || rules.scopedDelegations.length !== 0) throw new Error('UNSUPPORTED_P0_POLICY');
  if (new Set(context.vendors.map((v) => v.id)).size !== context.vendors.length
      || new Set(context.agreements.map((a) => a.id)).size !== context.agreements.length) {
    throw new Error('AMBIGUOUS_POLICY_CONTEXT');
  }

  const check = checkExtraction({
    documentSha256: invoice.documentSha256, primaryReadId: invoice.primaryReadId,
    candidate: invoice.extraction, corroboration: invoice.corroboration,
  });
  const ex = check.extraction;
  const prior = context.priorInvoices.filter((p) => p.id !== invoice.id);
  const trace: PolicyDecision['trace'] = [];
  const reasons: DecisionReasonCode[] = [];
  let action: DecisionAction = 'APPROVE';
  const rank = { APPROVE: 0, ESCALATE: 1, BLOCK: 2 };
  const record = (rule: string, outcome: 'PASS' | 'BLOCK' | 'ESCALATE', explanation: string,
    evidence: PolicyDecision['trace'][number]['evidence'], reason?: DecisionReasonCode) => {
    trace.push({ rule, outcome, explanation, evidence });
    if (outcome !== 'PASS' && rank[outcome] > rank[action]) action = outcome;
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };

  record('EXTRACTION', check.status === 'CROSS_CHECKED' ? 'PASS' : 'ESCALATE',
    check.status === 'CROSS_CHECKED'
      ? 'Los cuatro campos críticos coinciden con la lectura separada del mismo documento.'
      : 'La extracción necesita corrección o corroboración; no permite autorización automática ni una excepción genérica.',
    { status: check.status, issues: check.issues.map((issue) => `${issue.code}:${issue.field ?? '*'}`).join(', ') },
    check.status === 'REVIEW_REQUIRED' ? 'INVALID_OR_MISSING_DATA' : undefined);

  const sameFile = prior.find((p) => p.documentSha256 === invoice.documentSha256);
  if (sameFile) record('DUPLICATE_HASH', 'BLOCK', 'Ya existe este mismo documento en la empresa.',
    { priorInvoiceId: sameFile.id, sha256: invoice.documentSha256 }, 'DUPLICATE_INVOICE');

  // Warnings still prohibit APPROVE, but corroborated fields can explain other failures.
  const usable = ex !== null && check.issues.every((issue) => issue.code === 'EXTRACTION_WARNING');
  const matches = usable ? context.vendors.filter((v) => normalizeText(v.name) === normalizeText(ex.vendorName)) : [];
  const vendor = matches.length === 1 ? matches[0]! : null;
  let agreement = null as z.infer<typeof AgreementSchema> | null;
  const compatibleBudget = budget !== null && usable && budget.currency === ex.currency
    && budget.currency === rules.currency && budget.periodKey === context.budgetPeriodKey;

  if (usable) {
    if (ex.issuedAt !== null && ex.dueDate! < ex.issuedAt) record('INVOICE_DATES', 'ESCALATE',
      'El vencimiento es anterior a la emisión; corregir las fechas antes de autorizar.',
      { issuedAt: ex.issuedAt, dueDate: ex.dueDate }, 'INVALID_OR_MISSING_DATA');
    const number = normalizeInvoiceNumber(ex.invoiceNumber);
    const sameNumber = vendor && number
      ? prior.find((p) => p.vendorId === vendor.id && normalizeInvoiceNumber(p.extraction.invoiceNumber) === number)
      : undefined;
    if (sameNumber) record('DUPLICATE_NUMBER', 'BLOCK', 'El proveedor ya presentó este número de factura normalizado.',
      { priorInvoiceId: sameNumber.id, vendorId: vendor!.id, normalizedInvoiceNumber: number }, 'DUPLICATE_INVOICE');

    const possible = prior.find((p) => (!vendor || p.vendorId === vendor.id)
      && ex.amountMinor === p.extraction.amountMinor && ex.currency === p.extraction.currency
      && ex.issuedAt !== null && ex.issuedAt === p.extraction.issuedAt
      && normalizeText(ex.description) !== null && normalizeText(ex.description) === normalizeText(p.extraction.description));
    if (possible && !sameNumber && !sameFile) record('POSSIBLE_DUPLICATE', 'ESCALATE',
      'Importe, moneda, emisión y servicio coinciden con una factura previa; aclarar identidad y referencia antes de decidir.',
      { priorInvoiceId: possible.id, vendorName: ex.vendorName, amountMinor: ex.amountMinor }, 'POSSIBLE_DUPLICATE');

    if (matches.length > 1 || (!vendor && possible)) {
      record('VENDOR', 'ESCALATE', 'La identidad del proveedor es ambigua; no se asigna por parecido de nombre.',
        { extractedVendorName: ex.vendorName, matchingVendors: matches.length }, 'INVALID_OR_MISSING_DATA');
    } else if ((vendor && !vendor.allowed) || (!vendor && rules.requireAllowedVendor)) {
      record('VENDOR', 'BLOCK', vendor ? 'El proveedor está expresamente desautorizado.' : 'El proveedor no está en la lista permitida.',
        { extractedVendorName: ex.vendorName, vendorId: vendor?.id ?? null, allowed: vendor?.allowed ?? null }, 'UNKNOWN_VENDOR');
    } else {
      record('VENDOR', 'PASS', vendor ? 'El proveedor coincide exactamente con el registro de la empresa.' : 'El mandato permite proveedores sin registro.',
        { vendorId: vendor?.id ?? null, allowed: vendor?.allowed ?? null, requireAllowedVendor: rules.requireAllowedVendor });
    }

    if (vendor) {
      const candidates = context.agreements.filter((a) => a.vendorId === vendor.id
        && (invoice.agreementReference ? a.id === invoice.agreementReference
          : a.active && a.currency === ex.currency && normalizeText(a.concept) === normalizeText(ex.description)));
      if (candidates.length === 1) agreement = candidates[0]!;
      if (candidates.length > 1) record('AGREEMENT_IDENTITY', 'ESCALATE', 'Hay varios acuerdos posibles; no elegir uno automáticamente.',
        { vendorId: vendor.id, candidates: candidates.length }, 'AGREEMENT_MISMATCH');
    }

    if (!agreement || !agreement.active) {
      if (rules.requireAgreement || invoice.agreementReference !== null) record('AGREEMENT', 'ESCALATE',
        'No existe un acuerdo activo inequívoco de este proveedor para el servicio indicado.',
        { agreementReference: invoice.agreementReference, vendorId: vendor?.id ?? null, active: agreement?.active ?? null }, 'MISSING_AGREEMENT');
      else record('AGREEMENT', 'PASS', 'El mandato permite facturas sin acuerdo.', { requireAgreement: false });
    } else {
      const amountMatches = ex.amountMinor !== null
        && Math.abs(ex.amountMinor - agreement.amountMinor) <= agreement.toleranceMinor;
      const matchesAgreement = amountMatches && ex.currency === agreement.currency
        && normalizeText(ex.description) === normalizeText(agreement.concept);
      record('AGREEMENT', matchesAgreement ? 'PASS' : 'ESCALATE',
        matchesAgreement ? 'Importe, moneda y concepto coinciden con el acuerdo activo.' : 'La factura difiere del importe, moneda o concepto del acuerdo.',
        { agreementId: agreement.id, amountMinor: ex.amountMinor, agreedAmountMinor: agreement.amountMinor,
          toleranceMinor: agreement.toleranceMinor, currency: ex.currency, agreedCurrency: agreement.currency,
          description: ex.description, agreedConcept: agreement.concept },
        matchesAgreement ? undefined : 'AGREEMENT_MISMATCH');
      if (agreement.frequency === 'MONTHLY' && ex.servicePeriod === null) record('SERVICE_PERIOD', 'ESCALATE',
        'El acuerdo mensual requiere un periodo de servicio explícito; no se deduce del vencimiento.',
        { agreementId: agreement.id }, 'INVALID_OR_MISSING_DATA');
    }
    if (agreement) {
      const obligation = prior.find((p) => p.reservationActive && p.agreementId === agreement!.id
        && (agreement!.frequency === 'ONE_TIME' || (ex.servicePeriod !== null && ex.servicePeriod === p.extraction.servicePeriod)));
      if (obligation) record('DUPLICATE_OBLIGATION', 'BLOCK', 'Esta obligación del acuerdo ya tiene una reserva activa.',
        { agreementId: agreement.id, priorInvoiceId: obligation.id, servicePeriod: ex.servicePeriod }, 'DUPLICATE_INVOICE');
    }

    if (ex.currency !== rules.currency) record('CURRENCY', 'BLOCK', 'La moneda no está cubierta por este mandato; no se convierte automáticamente.',
      { invoiceCurrency: ex.currency, policyCurrency: rules.currency }, 'INVALID_CURRENCY');
    else record('CURRENCY', 'PASS', 'La moneda coincide con el mandato.', { currency: ex.currency });

    const overHard = ex.amountMinor! > rules.hardLimitMinor;
    record('HARD_LIMIT', overHard ? 'BLOCK' : 'PASS', overHard ? 'El importe supera el techo absoluto.' : 'El importe no supera el techo absoluto.',
      { amountMinor: ex.amountMinor, hardLimitMinor: rules.hardLimitMinor }, overHard ? 'AMOUNT_ABOVE_HARD_LIMIT' : undefined);

    if (!compatibleBudget) record('BUDGET', 'BLOCK', 'No existe presupuesto compatible para la moneda y periodo de evaluación.',
      { invoiceCurrency: ex.currency, periodKey: context.budgetPeriodKey, budgetCurrency: budget?.currency ?? null,
        budgetPeriodKey: budget?.periodKey ?? null }, 'MISSING_BUDGET');
    else {
      // A policy budget reduction must not be bypassed by a stale, larger budget row.
      const available = Math.min(budget!.availableMinor, Math.max(0, rules.monthlyBudgetMinor - budget!.reservedMinor));
      const enough = ex.amountMinor! <= available;
      record('BUDGET', enough ? 'PASS' : 'BLOCK', enough ? 'El presupuesto disponible cubre el importe.' : 'El presupuesto disponible no alcanza; una persona no puede autorizar saldo inexistente.',
        { amountMinor: ex.amountMinor, availableMinor: available, reservedMinor: budget!.reservedMinor,
          budgetLimitMinor: budget!.limitMinor, policyMonthlyBudgetMinor: rules.monthlyBudgetMinor }, enough ? undefined : 'BUDGET_EXCEEDED');
    }

    const aboveAutomatic = ex.amountMinor! > rules.automaticLimitMinor;
    const needsReview = aboveAutomatic || ex.amountMinor! > rules.reviewAboveMinor;
    if (aboveAutomatic) record('AUTO_LIMIT', rules.humanApprovalEnabled ? 'ESCALATE' : 'BLOCK', 'El importe supera el límite automático.',
      { amountMinor: ex.amountMinor, automaticLimitMinor: rules.automaticLimitMinor }, 'AMOUNT_ABOVE_AUTO_LIMIT');
    if (needsReview) record('HUMAN_REVIEW', rules.humanApprovalEnabled ? 'ESCALATE' : 'BLOCK',
      rules.humanApprovalEnabled ? 'El importe requiere autorización humana dentro de las demás reglas.' : 'El importe requiere revisión, pero el mandato no permite esa excepción.',
      { amountMinor: ex.amountMinor, reviewAboveMinor: rules.reviewAboveMinor, humanApprovalEnabled: rules.humanApprovalEnabled }, 'HUMAN_APPROVAL_REQUIRED');
    else record('AUTO_LIMIT', 'PASS', 'El importe está dentro de ambos umbrales automáticos.',
      { amountMinor: ex.amountMinor, automaticLimitMinor: rules.automaticLimitMinor, reviewAboveMinor: rules.reviewAboveMinor });
  }

  const finalAction = action as DecisionAction;
  if (finalAction === 'APPROVE') reasons.push('POLICY_ALLOWED');
  const needsHumanApproval = finalAction === 'ESCALATE' && reasons.includes('HUMAN_APPROVAL_REQUIRED')
    && reasons.every((reason) => reason === 'HUMAN_APPROVAL_REQUIRED' || reason === 'AMOUNT_ABOVE_AUTO_LIMIT');
  const findings = trace.filter((entry) => entry.outcome !== 'PASS').map((entry) => entry.explanation);
  const candidate = PolicyDecisionSchema.parse({
    id: context.decisionId, invoiceId: invoice.id, action: finalAction, reasons,
    humanExplanation: findings.length
      ? `${finalAction === 'BLOCK' ? 'Bloqueada para pago simulado.' : 'Requiere revisión.'} ${findings.join(' ')}`
      : 'La factura cumple el mandato y es elegible para aprobación simulada tras reservar presupuesto de forma atómica.',
    policyVersionId: policy.id, policyVersion: policy.version, checkedAt: context.checkedAt,
    needsHumanApproval, actor: { kind: 'SYSTEM', userId: null },
    facts: { amountMinor: ex?.amountMinor ?? null, currency: ex?.currency ?? null,
      automaticLimitMinor: rules.automaticLimitMinor, hardLimitMinor: rules.hardLimitMinor,
      budgetAvailableBeforeMinor: compatibleBudget ? Math.min(budget!.availableMinor, Math.max(0, rules.monthlyBudgetMinor - budget!.reservedMinor)) : null,
      vendorAllowed: vendor?.allowed ?? null, agreementId: agreement?.id ?? null },
    trace, simulated: true,
  });
  return { candidate, vendorId: vendor?.id ?? null, agreementId: agreement?.id ?? null,
    budgetPeriodId: compatibleBudget ? budget!.id : null, requiresBudgetReservation: finalAction === 'APPROVE' };
}

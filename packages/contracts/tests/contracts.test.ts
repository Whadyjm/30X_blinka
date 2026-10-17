import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import {
  ActivateMandateSchema, ApiErrorSchema, ApprovalRequestSchema, BudgetPeriodSchema,
  CreateAgreementSchema, CreateVendorSchema, CurrencySchema, DateSchema,
  ExtractedInvoiceSchema, InvoiceQuerySchema, InvoiceSchema, MAX_INVOICE_BYTES,
  MandateRulesSchema, MinorUnitsSchema, PaginationSchema, PolicyDecisionSchema,
  ReviewApprovalSchema, SaveMandateDraftSchema, UpdateVendorSchema,
  UploadFileMetadataSchema,
} from '../src/index.ts';

const document = readFileSync(new URL('../../../docs/API.md', import.meta.url), 'utf8');
const examples = [...document.matchAll(/^```json\n([\s\S]*?)^```/gm)]
  .map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
const draft = SaveMandateDraftSchema.parse(examples.find((value) => 'rules' in value));
const received = InvoiceSchema.parse(
  examples.find((value) => (value.data as { source?: string } | undefined)?.source === 'HUMAN_UPLOAD')!.data,
);

test('los ejemplos JSON publicados respetan los esquemas compartidos', () => {
  const invoiceEnvelope = z.strictObject({ data: InvoiceSchema });
  const emptyPage = z.strictObject({ data: z.array(z.never()), pagination: PaginationSchema });
  for (const example of examples) {
    if ('expectedDecisionId' in example) ReviewApprovalSchema.parse(example);
    else if ('rules' in example) SaveMandateDraftSchema.parse(example);
    else if ('action' in example) PolicyDecisionSchema.parse(example);
    else if ('state' in example) ApprovalRequestSchema.parse(example);
    else if ('pagination' in example) emptyPage.parse(example);
    else if ('error' in example) ApiErrorSchema.parse(example);
    else invoiceEnvelope.parse(example);
  }
});

test('montos no aceptan floats, negativos, coerción ni enteros inseguros', () => {
  for (const amount of [-1, 1.01, '45000', null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(MinorUnitsSchema.safeParse(amount).success, false, String(amount));
  }
  assert.equal(MinorUnitsSchema.parse(0), 0);
  assert.equal(MinorUnitsSchema.parse(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test('límites incompatibles y programación P1 no pasan como configuración P0', () => {
  assert.equal(SaveMandateDraftSchema.safeParse({
    ...draft, rules: { ...draft.rules, hardLimitMinor: 100 },
  }).success, false);
  assert.equal(MandateRulesSchema.safeParse({
    ...draft.rules, reviewAboveMinor: draft.rules.automaticLimitMinor + 1,
  }).success, false);
  assert.equal(SaveMandateDraftSchema.safeParse({
    ...draft, rules: { ...draft.rules, processDaysBeforeDue: 1 },
  }).success, false);
  assert.equal(ActivateMandateSchema.safeParse({
    draftId: 'draft_1', expectedRevision: 1,
    expectedActivePolicyVersionId: null, confirmed: false,
  }).success, false);
});

test('delegaciones no pueden superar el techo ni mezclar monedas', () => {
  const rule = {
    vendorId: 'vendor_1', agreementId: 'agreement_1', currency: 'USD',
    maxAmountMinor: 45000, validFrom: '2026-10-01', validUntil: '2026-12-31', maxPerPeriod: 1,
  };
  assert.equal(MandateRulesSchema.safeParse({ ...draft.rules, scopedDelegations: [rule] }).success, true);
  for (const invalid of [
    { ...rule, maxAmountMinor: draft.rules.hardLimitMinor + 1 },
    { ...rule, currency: 'EUR' },
    { ...rule, validUntil: '2026-09-30' },
  ]) {
    assert.equal(MandateRulesSchema.safeParse({ ...draft.rules, scopedDelegations: [invalid] }).success, false);
  }
  assert.equal(SaveMandateDraftSchema.safeParse({
    ...draft, rules: { ...draft.rules, scopedDelegations: [rule] },
  }).success, false, 'P0 no activa reglas cuya implementación aún no existe');
});

test('el navegador no puede introducir identidad ni autoridad en las mutaciones', () => {
  for (const extra of [{ orgId: 'otra_empresa' }, { approved: true }, { role: 'OWNER' }]) {
    assert.equal(SaveMandateDraftSchema.safeParse({ ...draft, ...extra }).success, false);
    assert.equal(CreateVendorSchema.safeParse({ name: 'Acme', allowed: true, externalRef: null, ...extra }).success, false);
  }
  assert.equal(ReviewApprovalSchema.safeParse({
    action: 'APPROVE', comment: '   ', expectedDecisionId: 'decision_1', expectedPolicyVersionId: 'policy_1',
  }).success, false);
  assert.equal(ReviewApprovalSchema.safeParse({ action: 'APPROVE', comment: 'Autorizado' }).success, false);
  assert.equal(UpdateVendorSchema.safeParse({}).success, false);
});

test('extracción incompleta permanece null y no puede incluir una autorización del modelo', () => {
  const extraction = {
    vendorName: null, invoiceNumber: null, amountMinor: null, currency: null,
    issuedAt: null, dueDate: null, servicePeriod: null, description: null,
    extractionWarnings: ['Monto ilegible'], evidence: [],
  };
  assert.deepEqual(ExtractedInvoiceSchema.parse(extraction), extraction);
  assert.equal(ExtractedInvoiceSchema.safeParse({ ...extraction, approved: true }).success, false);
  assert.equal(ExtractedInvoiceSchema.safeParse({ ...extraction, action: 'APPROVE' }).success, false);
});

test('monedas y fechas inválidas no pasan como datos normalizados', () => {
  assert.equal(CurrencySchema.parse('USD'), 'USD');
  assert.equal(CurrencySchema.parse('COP'), 'COP');
  assert.equal(CurrencySchema.parse('JPY'), 'JPY');
  for (const currency of ['usd', 'ZZZ', 'US', 'US D']) {
    assert.equal(CurrencySchema.safeParse(currency).success, false, currency);
  }
  assert.equal(DateSchema.parse('2028-02-29'), '2028-02-29');
  for (const date of ['2026-02-29', '2026-04-31', '17/10/2026']) {
    assert.equal(DateSchema.safeParse(date).success, false, date);
  }
});

test('presupuestos no pueden ocultar reservas ni exceder el límite', () => {
  const budget = { id: 'budget_1', currency: 'USD', periodKey: '2026-10', limitMinor: 30000, reservedMinor: 20000, availableMinor: 10000 };
  assert.deepEqual(BudgetPeriodSchema.parse(budget), budget);
  for (const invalid of [
    { ...budget, reservedMinor: 40000 },
    { ...budget, availableMinor: 30000 },
    { ...budget, periodKey: '2026-13' },
  ]) assert.equal(BudgetPeriodSchema.safeParse(invalid).success, false);
});

test('archivos y acuerdos rechazan tamaños, formatos e importes fuera del contrato', () => {
  const file = { name: 'demo.pdf', mimeType: 'application/pdf', sizeBytes: MAX_INVOICE_BYTES };
  assert.deepEqual(UploadFileMetadataSchema.parse(file), file);
  assert.equal(UploadFileMetadataSchema.safeParse({ ...file, sizeBytes: MAX_INVOICE_BYTES + 1 }).success, false);
  assert.equal(UploadFileMetadataSchema.safeParse({ ...file, mimeType: 'text/html' }).success, false);
  assert.equal(CreateAgreementSchema.safeParse({
    vendorId: 'vendor_1', currency: 'USD', amountMinor: 0, toleranceMinor: 0,
    frequency: 'MONTHLY', concept: 'Contabilidad', active: true,
  }).success, false);
});

test('filtros HTTP distinguen false de true y limitan la paginación', () => {
  assert.deepEqual(InvoiceQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(InvoiceQuerySchema.parse({ needsHumanApproval: 'false' }).needsHumanApproval, false);
  assert.equal(InvoiceQuerySchema.parse({ needsHumanApproval: 'true' }).needsHumanApproval, true);
  assert.equal(InvoiceQuerySchema.parse({ page: '2', pageSize: '100' }).pageSize, 100);
  for (const query of [
    { page: '0' }, { page: '2.5' }, { pageSize: '101' },
    { needsHumanApproval: 'yes' }, { orgId: 'otra_empresa' },
  ]) assert.equal(InvoiceQuerySchema.safeParse(query).success, false);
});

test('un estado técnico no se confunde con una decisión financiera', () => {
  assert.equal(received.status, 'RECEIVED');
  assert.equal(received.latestDecision, null);
  assert.equal(InvoiceSchema.safeParse({ ...received, status: 'APPROVE' }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...received, status: 'NEEDS_APPROVAL' }).success, false);
});

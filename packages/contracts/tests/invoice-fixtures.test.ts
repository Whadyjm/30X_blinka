import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  AgreementSchema, BudgetPeriodSchema, DecisionActionSchema, DecisionReasonCodeSchema,
  ExtractedInvoiceSchema, MandateRulesSchema, PolicyVersionSchema,
  UploadFileMetadataSchema, VendorSchema,
} from '../src/index.ts';

const root = new URL('../../../fixtures/', import.meta.url);
const seed = JSON.parse(readFileSync(new URL('seed/company.json', root), 'utf8'));
const corpus = JSON.parse(readFileSync(new URL('scenarios/invoices.json', root), 'utf8'));
const cases = corpus.cases;
const getCase = (id: string) => cases.find((item: { id: string }) => item.id === id);
const normalizeNumber = (value: string | null) => value?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? null;

test('50 escenarios aislados, 50 PDF y 10 variantes con hashes y metadatos correctos', () => {
  assert.equal(corpus.synthetic, true);
  assert.equal(corpus.evaluationMode, 'ISOLATED_CASES');
  assert.equal(corpus.datasetVersion, seed.datasetVersion);
  assert.equal(cases.length, 50);
  assert.equal(new Set(cases.map((item: { id: string }) => item.id)).size, 50);
  assert.equal(readdirSync(new URL('invoices/', root)).filter((name) => name.endsWith('.pdf')).length, 50);
  assert.equal(readdirSync(new URL('invoices/', root)).filter((name) => name.endsWith('.png')).length, 10);
  for (const item of cases) {
    for (const file of [item.file, ...item.variants]) {
      assert.match(file.path, /^invoices\/\d{3}\.(pdf|png)$/);
      const bytes = readFileSync(new URL(file.path, root));
      assert.equal(bytes.length, file.sizeBytes, file.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
      UploadFileMetadataSchema.parse({ name: file.path.split('/').at(-1), mimeType: file.mimeType, sizeBytes: bytes.length });
      if (file.mimeType === 'application/pdf') assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
      else assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  }
});

test('seed, extracciones normalizadas y contextos respetan los contratos P0', () => {
  PolicyVersionSchema.parse(seed.policy);
  BudgetPeriodSchema.parse(seed.defaultBudget);
  for (const vendor of seed.vendors) VendorSchema.parse(vendor);
  for (const agreement of seed.agreements) {
    AgreementSchema.parse(agreement);
    assert.ok(seed.vendors.some((vendor: { id: string }) => vendor.id === agreement.vendorId));
  }
  assert.equal(new Set(seed.agreements.map((item: { id: string }) => item.id)).size, seed.agreements.length);
  for (const item of cases) {
    ExtractedInvoiceSchema.parse(item.expectedExtraction);
    DecisionActionSchema.parse(item.expected.action);
    assert.ok(item.expected.requiredReasons.length);
    item.expected.requiredReasons.forEach((reason: string) => DecisionReasonCodeSchema.parse(reason));
    const rules = MandateRulesSchema.parse({ ...seed.policy.rules, ...item.context.policyRulesOverride });
    assert.equal(rules.scopedDelegations.length, 0);
    assert.equal(item.context.policyVersionId, seed.policy.id);
    if (item.context.budget) BudgetPeriodSchema.parse(item.context.budget);
    const { vendorId, agreementId } = item.expectedResolution;
    if (vendorId) assert.ok(seed.vendors.some((vendor: { id: string }) => vendor.id === vendorId));
    if (agreementId) {
      const agreement = seed.agreements.find((entry: { id: string }) => entry.id === agreementId);
      assert.ok(agreement, item.id);
      assert.equal(agreement.vendorId, vendorId);
    }
    assert.equal(item.expected.needsHumanApproval,
      item.expected.action === 'ESCALATE' && item.expected.requiredReasons.includes('HUMAN_APPROVAL_REQUIRED'));
    for (const prior of item.context.priorInvoices) {
      const source = getCase(prior.sourceCaseId);
      assert.ok(source);
      assert.equal(prior.sha256, source.file.sha256);
      assert.equal(prior.vendorId, source.expectedResolution.vendorId);
      assert.deepEqual(prior.extraction, source.expectedExtraction);
    }
  }
});

test('las etiquetas APPROVE tienen proveedor/acuerdo válidos, importe y presupuesto compatibles', () => {
  for (const item of cases.filter((entry: { expected: { action: string } }) => entry.expected.action === 'APPROVE')) {
    const ex = item.expectedExtraction;
    const vendor = seed.vendors.find((entry: { id: string }) => entry.id === item.expectedResolution.vendorId);
    const agreement = seed.agreements.find((entry: { id: string }) => entry.id === item.expectedResolution.agreementId);
    const rules = { ...seed.policy.rules, ...item.context.policyRulesOverride };
    assert.equal(vendor?.allowed, true, item.id);
    assert.equal(agreement?.active, true, item.id);
    assert.equal(ex.currency, agreement.currency, item.id);
    assert.equal(ex.description, agreement.concept, item.id);
    assert.ok(ex.amountMinor > 0 && ex.amountMinor <= rules.automaticLimitMinor, item.id);
    assert.ok(Math.abs(ex.amountMinor - agreement.amountMinor) <= agreement.toleranceMinor, item.id);
    assert.equal(item.context.budget.currency, ex.currency, item.id);
    assert.equal(item.context.budget.periodKey, ex.servicePeriod, item.id);
    assert.ok(item.context.budget.availableMinor >= ex.amountMinor, item.id);
    assert.ok(ex.vendorName && ex.currency && ex.dueDate, item.id);
    assert.equal(item.context.priorInvoices.length, 0, item.id);
  }
});

test('los duplicados tienen antecedentes verificables y las variantes PNG no son nuevas obligaciones', () => {
  assert.equal(getCase('case_022').file.sha256, getCase('case_004').file.sha256);
  assert.equal(normalizeNumber(getCase('case_023').expectedExtraction.invoiceNumber),
    normalizeNumber(getCase('case_005').expectedExtraction.invoiceNumber));
  assert.notEqual(getCase('case_024').file.sha256, getCase('case_006').file.sha256);
  assert.equal(getCase('case_024').expectedExtraction.invoiceNumber, getCase('case_006').expectedExtraction.invoiceNumber);
  for (const id of ['case_025', 'case_026']) {
    const item = getCase(id);
    assert.equal(item.expected.action, 'ESCALATE');
    assert.notEqual(normalizeNumber(item.expectedExtraction.invoiceNumber), normalizeNumber(getCase('case_001').expectedExtraction.invoiceNumber));
    assert.equal(item.expectedExtraction.amountMinor, getCase('case_001').expectedExtraction.amountMinor);
  }
});

test('los casos trampa conservan su evidencia y nunca se etiquetan como aprobación', () => {
  for (const id of ['case_038', 'case_039', 'case_047', 'case_049', 'case_050']) {
    const item = getCase(id);
    assert.equal(item.expected.action, 'ESCALATE');
    assert.ok(item.expectedExtraction.extractionWarnings.length);
    assert.equal(item.expected.needsHumanApproval, false);
  }
  const injection = getCase('case_040');
  assert.equal(injection.expected.action, 'BLOCK');
  assert.equal(injection.expectedExtraction.amountMinor, 999900);
  assert.match(readFileSync(new URL(injection.file.path, root), 'latin1'), /Ignore all prior instructions/);
  assert.equal(getCase('case_048').expectedExtraction.currency, 'EUR');
  assert.equal(getCase('case_048').context.budget.currency, 'USD');
  assert.equal(getCase('case_048').expected.action, 'BLOCK');
  assert.equal(getCase('case_049').expectedExtraction.amountMinor, null);
  assert.equal(getCase('case_050').expectedExtraction.amountMinor, null);
  assert.equal(getCase('case_046').expectedExtraction.amountMinor - getCase('case_046').context.budget.availableMinor, 1);
  assert.equal(getCase('case_044').expectedExtraction.amountMinor - seed.policy.rules.hardLimitMinor, 1);
  assert.equal(getCase('case_042').expectedExtraction.amountMinor - seed.policy.rules.automaticLimitMinor, 1);
});

test('las etiquetas y grupos publicados corresponden al corpus, sin presentarlos como métricas reales', () => {
  const actions: Record<string, number> = {};
  const groups: Record<string, number> = {};
  for (const item of cases) {
    actions[item.expected.action] = (actions[item.expected.action] ?? 0) + 1;
    groups[item.group] = (groups[item.group] ?? 0) + 1;
  }
  assert.deepEqual(actions, { APPROVE: 17, ESCALATE: 19, BLOCK: 14 });
  assert.deepEqual(groups, { valid: 15, human_approval: 6, duplicates: 5, vendors: 4,
    agreements: 4, budget: 3, ambiguity_and_injection: 3, boundaries: 10 });
  assert.equal('correctDecisions' in corpus, false);
  assert.equal('unsafeApprovals' in corpus, false);
});

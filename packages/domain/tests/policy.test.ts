import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PolicyDecisionSchema } from '@oli/contracts';
import type { ExtractedInvoice } from '@oli/contracts';
import { evaluateInvoice } from '../src/index.ts';
import type { PolicyContext, PolicyInvoice } from '../src/index.ts';
import { evaluatePolicyCorpus } from '../../../scripts/run-policy-evaluation.mts';

const seed = JSON.parse(readFileSync(new URL('../../../fixtures/seed/company.json', import.meta.url), 'utf8'));
const corpus = JSON.parse(readFileSync(new URL('../../../fixtures/scenarios/invoices.json', import.meta.url), 'utf8'));

function example() {
  const ex: ExtractedInvoice = structuredClone(corpus.cases[0].expectedExtraction);
  const invoice: PolicyInvoice = {
    id: 'invoice_test', documentSha256: corpus.cases[0].file.sha256, primaryReadId: 'visual_test',
    agreementReference: corpus.cases[0].document.agreementReference, extraction: ex,
    corroboration: { documentSha256: corpus.cases[0].file.sha256, readId: 'parser_test', method: 'PDF_TEXT',
      fields: { vendorName: ex.vendorName, amountMinor: ex.amountMinor, currency: ex.currency, dueDate: ex.dueDate } },
  };
  const context: PolicyContext = structuredClone({
    organizationId: seed.organization.id, decisionId: 'decision_test', checkedAt: corpus.evaluationTime,
    budgetPeriodKey: '2026-10', policy: seed.policy, vendors: seed.vendors,
    agreements: seed.agreements, budget: seed.defaultBudget, priorInvoices: [],
  });
  return { invoice, context };
}

function changeExtraction(invoice: PolicyInvoice, changes: Partial<ExtractedInvoice>) {
  const ex = { ...invoice.extraction as ExtractedInvoice, ...changes };
  invoice.extraction = ex;
  invoice.corroboration = {
    documentSha256: invoice.documentSha256, readId: 'parser_test', method: 'PDF_TEXT',
    fields: { vendorName: ex.vendorName, amountMinor: ex.amountMinor, currency: ex.currency, dueDate: ex.dueDate },
  };
}

function priorFor(invoice: PolicyInvoice, context: PolicyContext): PolicyContext['priorInvoices'][number] {
  return {
    id: 'prior_invoice', documentSha256: 'b'.repeat(64), vendorId: context.vendors[0]!.id,
    agreementId: invoice.agreementReference, extraction: structuredClone(invoice.extraction as ExtractedInvoice),
    reservationActive: false,
  };
}

test('50 escenarios etiquetados antes de construir el motor coinciden en acción, motivos y necesidad humana', async (t) => {
  const report = evaluatePolicyCorpus();
  for (const item of report.cases) {
    await t.test(item.id, () => {
      assert.equal(item.correct, true, JSON.stringify({ expected: item.expected, actual: item.actual.candidate }));
      PolicyDecisionSchema.parse(item.actual.candidate);
      assert.equal(item.actual.requiresBudgetReservation, item.actual.candidate.action === 'APPROVE');
    });
  }
  assert.equal(report.summary.unsafeApprovals, 0);
  assert.equal(report.summary.correctDecisions, 50);
  assert.equal(report.syntheticCorroboration, true);
  const ambiguous = report.cases.find((item) => item.id === 'case_025')!;
  assert.equal(ambiguous.actual.vendorId, null, 'Un nombre parecido nunca resuelve identidad financiera.');
});

test('la misma factura cambia de decisión al cambiar los datos del onboarding, sin cambiar código', () => {
  const { invoice, context } = example();
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  context.policy.rules.automaticLimitMinor = 4000;
  context.policy.rules.reviewAboveMinor = 4000;
  const needsPerson = evaluateInvoice(invoice, context);
  assert.equal(needsPerson.candidate.action, 'ESCALATE');
  assert.equal(needsPerson.candidate.needsHumanApproval, true);
  context.vendors[0]!.allowed = false;
  const forbidden = evaluateInvoice(invoice, context);
  assert.equal(forbidden.candidate.action, 'BLOCK');
  assert.equal(forbidden.candidate.needsHumanApproval, false);
});

test('proveedores, acuerdos y límites no dependen de los nombres/IDs del seed', () => {
  const { invoice, context } = example();
  const vendor = { ...context.vendors[0]!, id: 'custom_vendor', name: 'Otro proveedor ficticio' };
  context.vendors = [vendor];
  context.agreements = [{ ...context.agreements[0]!, id: 'custom_agreement', vendorId: vendor.id }];
  invoice.agreementReference = 'custom_agreement';
  changeExtraction(invoice, { vendorName: vendor.name });
  const result = evaluateInvoice(invoice, context);
  assert.equal(result.candidate.action, 'APPROVE');
  assert.equal(result.vendorId, vendor.id);
  assert.equal(result.agreementId, 'custom_agreement');
});

test('evaluar es determinista y no muta política, antecedentes ni reservas', () => {
  const { invoice, context } = example();
  const before = JSON.stringify({ invoice, context });
  assert.deepEqual(evaluateInvoice(invoice, context), evaluateInvoice(invoice, context));
  assert.equal(JSON.stringify({ invoice, context }), before);
  assert.equal(context.budget!.reservedMinor, 0);
});

test('un umbral humano menor que el automático se respeta; la igualdad es inclusiva', () => {
  const { invoice, context } = example();
  context.policy.rules.reviewAboveMinor = 4999;
  let result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'ESCALATE');
  assert.equal(result.needsHumanApproval, true);
  assert.equal(result.reasons.includes('AMOUNT_ABOVE_AUTO_LIMIT'), false);
  context.policy.rules.reviewAboveMinor = 5000;
  result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'APPROVE');
});

test('si la revisión humana está desactivada, superar el umbral bloquea', () => {
  const { invoice, context } = example();
  context.policy.rules.reviewAboveMinor = 4999;
  context.policy.rules.humanApprovalEnabled = false;
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.needsHumanApproval, false);
});

test('BLOCK prevalece y conserva razones de duplicado, prohibición, techo y falta de presupuesto', () => {
  const { invoice, context } = example();
  context.policy.rules.automaticLimitMinor = 4000;
  context.policy.rules.reviewAboveMinor = 4000;
  context.policy.rules.hardLimitMinor = 4999;
  context.vendors[0]!.allowed = false;
  context.budget = { ...context.budget!, limitMinor: 0, availableMinor: 0 };
  context.priorInvoices = [{ ...priorFor(invoice, context), documentSha256: invoice.documentSha256 }];
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.needsHumanApproval, false);
  for (const reason of ['DUPLICATE_INVOICE', 'UNKNOWN_VENDOR', 'AMOUNT_ABOVE_HARD_LIMIT', 'BUDGET_EXCEEDED']) {
    assert.ok(result.reasons.includes(reason as typeof result.reasons[number]), reason);
  }
});

test('un JSON del modelo válido sin lectura separada nunca permite aprobar', () => {
  const { invoice, context } = example();
  invoice.corroboration = null;
  const result = evaluateInvoice(invoice, context);
  assert.equal(result.candidate.action, 'ESCALATE');
  assert.equal(result.candidate.needsHumanApproval, false);
  assert.equal(result.requiresBudgetReservation, false);
});

test('otro documento, la misma lectura o campos discrepantes no permiten aprobar', () => {
  for (const kind of ['hash', 'read', 'amount']) {
    const { invoice, context } = example();
    const source = structuredClone(invoice.corroboration) as { documentSha256: string; readId: string; fields: { amountMinor: number } };
    if (kind === 'hash') source.documentSha256 = 'a'.repeat(64);
    if (kind === 'read') source.readId = invoice.primaryReadId;
    if (kind === 'amount') source.fields.amountMinor += 1;
    invoice.corroboration = source;
    const result = evaluateInvoice(invoice, context).candidate;
    assert.equal(result.action, 'ESCALATE', kind);
    assert.equal(result.needsHumanApproval, false, kind);
  }
});

test('importes inválidos, cero, negativos o autoridad incluida por el modelo no pasan', () => {
  for (const changes of [{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.2 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { approved: true }, { currency: 'XYZ' }]) {
    const { invoice, context } = example();
    invoice.extraction = { ...invoice.extraction as ExtractedInvoice, ...changes };
    const result = evaluateInvoice(invoice, context).candidate;
    assert.equal(result.action, 'ESCALATE', JSON.stringify(changes));
    assert.equal(result.needsHumanApproval, false);
  }
});

test('un hash duplicado del servidor bloquea incluso si el parser falla', () => {
  const { invoice, context } = example();
  context.priorInvoices = [{ ...priorFor(invoice, context), documentSha256: invoice.documentSha256 }];
  invoice.extraction = { broken: true };
  invoice.corroboration = null;
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'BLOCK');
  assert.ok(result.reasons.includes('INVALID_OR_MISSING_DATA'));
  assert.ok(result.reasons.includes('DUPLICATE_INVOICE'));
});

test('monedas y periodos de presupuesto no se mezclan ni se convierten', () => {
  for (const mismatch of ['currency', 'period']) {
    const { invoice, context } = example();
    if (mismatch === 'currency') {
      changeExtraction(invoice, { currency: 'EUR' });
      context.agreements[0]!.currency = 'EUR';
    } else context.budget!.periodKey = '2026-09';
    const result = evaluateInvoice(invoice, context);
    assert.equal(result.candidate.action, 'BLOCK');
    assert.ok(result.candidate.reasons.includes('MISSING_BUDGET'));
    assert.equal(result.budgetPeriodId, null);
  }
});

test('una fila de presupuesto antigua no evade una reducción del mandato', () => {
  const { invoice, context } = example();
  context.policy.rules.monthlyBudgetMinor = 4999;
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'BLOCK');
});

test('discrepancia de acuerdo no crea una excepción humana aunque supere también el automático', () => {
  const { invoice, context } = example();
  context.agreements[0]!.amountMinor = 4900;
  context.policy.rules.reviewAboveMinor = 4000;
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'ESCALATE');
  assert.ok(result.reasons.includes('AGREEMENT_MISMATCH'));
  assert.ok(result.reasons.includes('HUMAN_APPROVAL_REQUIRED'));
  assert.equal(result.needsHumanApproval, false);
});

test('tolerancia exacta y discrepancia de un centavo se calculan en enteros', () => {
  const { invoice, context } = example();
  context.agreements[0]!.amountMinor = 4900;
  context.agreements[0]!.toleranceMinor = 100;
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  context.agreements[0]!.toleranceMinor = 99;
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'ESCALATE');
});

test('no deduce el periodo mensual de una fecha de vencimiento', () => {
  const { invoice, context } = example();
  context.agreements[0]!.frequency = 'MONTHLY';
  changeExtraction(invoice, { servicePeriod: null });
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'ESCALATE');
  assert.equal(result.needsHumanApproval, false);
  assert.ok(result.reasons.includes('INVALID_OR_MISSING_DATA'));
});

test('obligación mensual reservada no se repite; un periodo diferente sí se evalúa', () => {
  const { invoice, context } = example();
  context.agreements[0]!.frequency = 'MONTHLY';
  const prior = priorFor(invoice, context);
  prior.reservationActive = true;
  prior.extraction.invoiceNumber = 'DIFFERENT';
  prior.extraction.issuedAt = '2026-10-02';
  context.priorInvoices = [prior];
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'BLOCK');
  context.agreements[0]!.active = false;
  assert.ok(evaluateInvoice(invoice, context).candidate.reasons.includes('DUPLICATE_INVOICE'));
  context.agreements[0]!.active = true;
  prior.extraction.servicePeriod = '2026-09';
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
});

test('acuerdo de una vez no autoriza otra obligación aunque cambie el periodo', () => {
  const { invoice, context } = example();
  const prior = priorFor(invoice, context);
  prior.reservationActive = true;
  prior.extraction.invoiceNumber = 'DIFFERENT';
  prior.extraction.issuedAt = '2026-09-01';
  prior.extraction.servicePeriod = '2026-09';
  context.priorInvoices = [prior];
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'BLOCK');
});

test('una referencia a acuerdo de otro proveedor no otorga autorización', () => {
  const { invoice, context } = example();
  invoice.agreementReference = context.agreements[1]!.id;
  const result = evaluateInvoice(invoice, context).candidate;
  assert.equal(result.action, 'ESCALATE');
  assert.equal(result.needsHumanApproval, false);
});

test('sin referencia solo usa un acuerdo activo inequívoco por proveedor, moneda y concepto', () => {
  const { invoice, context } = example();
  invoice.agreementReference = null;
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  context.agreements.push({ ...context.agreements[0]!, id: 'second_matching_agreement' });
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'ESCALATE');
});

test('desactivar requisitos explícitamente permite casos nuevos; no anula proveedores prohibidos', () => {
  const { invoice, context } = example();
  context.policy.rules.requireAllowedVendor = false;
  context.policy.rules.requireAgreement = false;
  invoice.agreementReference = null;
  context.agreements = [];
  changeExtraction(invoice, { vendorName: 'Nuevo proveedor ficticio' });
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  context.vendors.push({ ...context.vendors[0]!, id: 'denied_new_vendor', name: 'Nuevo proveedor ficticio', allowed: false });
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'BLOCK');
});

test('fechas imposibles requieren revisión; facturas futuras o vencidas no ejecutan un scheduler', () => {
  const { invoice, context } = example();
  changeExtraction(invoice, { issuedAt: '2026-10-10', dueDate: '2026-10-09' });
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'ESCALATE');
  changeExtraction(invoice, { issuedAt: '2026-02-01', dueDate: '2026-02-30' });
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'ESCALATE');
  for (const dueDate of ['2026-03-01', '2027-03-01']) {
    changeExtraction(invoice, { issuedAt: '2026-02-01', dueDate });
    assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  }
});

test('configuración inválida, política inactiva y funciones P1 no soportadas fallan sin aprobar', () => {
  const first = example();
  first.context.policy.status = 'SUPERSEDED';
  assert.throws(() => evaluateInvoice(first.invoice, first.context), /POLICY_NOT_ACTIVE/);
  const second = example();
  second.context.policy.rules.hardLimitMinor = 1;
  assert.throws(() => evaluateInvoice(second.invoice, second.context));
  const third = example();
  third.context.policy.rules.processDaysBeforeDue = 1;
  assert.throws(() => evaluateInvoice(third.invoice, third.context), /UNSUPPORTED_P0_POLICY/);
  const fourth = example();
  fourth.context.policy.rules.scopedDelegations = [{ vendorId: 'ven_demo_1', agreementId: 'agr_demo_001',
    currency: 'USD', maxAmountMinor: 45000, validFrom: '2026-10-01', validUntil: '2026-12-31', maxPerPeriod: 1 }];
  assert.throws(() => evaluateInvoice(fourth.invoice, fourth.context), /UNSUPPORTED_P0_POLICY/);
});

test('entero máximo seguro funciona sin floats monetarios; presupuestos inválidos se rechazan', () => {
  const { invoice, context } = example();
  const maximum = Number.MAX_SAFE_INTEGER;
  changeExtraction(invoice, { amountMinor: maximum });
  context.agreements[0]!.amountMinor = maximum;
  context.policy.rules.automaticLimitMinor = maximum;
  context.policy.rules.reviewAboveMinor = maximum;
  context.policy.rules.hardLimitMinor = maximum;
  context.policy.rules.monthlyBudgetMinor = maximum;
  context.budget = { ...context.budget!, limitMinor: maximum, reservedMinor: 0, availableMinor: maximum };
  assert.equal(evaluateInvoice(invoice, context).candidate.action, 'APPROVE');
  context.budget.availableMinor = maximum - 1;
  assert.throws(() => evaluateInvoice(invoice, context));
});

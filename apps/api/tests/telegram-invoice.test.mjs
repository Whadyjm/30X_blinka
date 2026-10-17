import assert from 'node:assert/strict';
import test from 'node:test';
import { emailNotice, invoiceNotice, invoiceSummary } from '../worker/telegram-invoice.js';

const env = { PUBLIC_APP_URL: 'https://oli.invalid' };
const invoice = (action, reasons, extra = {}) => ({ id: 'invoice-1', status: 'DECIDED', vendorName: 'Nimbo Cloud Demo',
  invoiceNumber: 'REF-PENDING', amountMinor: 5000, currency: 'USD', file: { name: 'image.png' },
  latestDecision: { action, reasons, humanExplanation: 'EXTRACCIÓN: corroboración; autorización automática; excepción genérica.',
    needsHumanApproval: false, trace: [], ...extra } });

test('invoice notices preserve approval, block and review outcomes without exposing internal explanations', () => {
  for (const [action, reason, pattern] of [
    ['APPROVE', 'POLICY_ALLOWED', /Quedó aprobada/],
    ['APPROVE', 'HUMAN_APPROVED', /aprobada tras la revisión/],
    ['BLOCK', 'DUPLICATE_INVOICE', /bloqueé.*ya está registrada/],
    ['BLOCK', 'BUDGET_EXCEEDED', /bloqueé.*presupuesto disponible no alcanza/],
    ['BLOCK', 'NOT_AN_INVOICE', /no parece ser una factura.*bloqueado/],
    ['BLOCK', 'HUMAN_REJECTED', /rechazada/],
    ['ESCALATE', 'INVALID_OR_MISSING_DATA', /No pude confirmar todos los datos/],
    ['ESCALATE', 'POSSIBLE_DUPLICATE', /confirmes si es la misma/],
    ['ESCALATE', 'MISSING_AGREEMENT', /confirmes el acuerdo/],
    ['ESCALATE', 'AGREEMENT_MISMATCH', /no coinciden con el acuerdo/],
    ['ESCALATE', 'DOCUMENT_TYPE_UNCERTAIN', /No pude confirmar.*sea una factura/],
  ]) {
    const i = invoice(action, [reason]), [part] = invoiceNotice(env, i);
    assert.match(part.text, pattern); assert.match(part.text, /50.00 USD/);
    assert.doesNotMatch(part.text, /EXTRACCIÓN|corroboración|excepción genérica|REF-PENDING|https:/);
    assert.equal(part.reply_markup.inline_keyboard[0][0].url, 'https://oli.invalid/app/bills/invoice-1');
    if (action !== 'APPROVE') assert.doesNotMatch(part.text, /Quedó aprobada|cumple con tus reglas/);
  }
});

test('block wins over uncertain reading, and uncertain reading never becomes a request to approve', () => {
  assert.match(invoiceSummary(invoice('BLOCK', ['INVALID_OR_MISSING_DATA', 'DUPLICATE_INVOICE'])), /bloqueé.*ya está registrada/);
  const uncertain = invoiceSummary(invoice('ESCALATE', ['INVALID_OR_MISSING_DATA', 'HUMAN_APPROVAL_REQUIRED']));
  assert.doesNotMatch(uncertain, /tu aprobación|aprobar/);
  assert.match(invoiceSummary(invoice('ESCALATE', ['HUMAN_APPROVAL_REQUIRED'], { needsHumanApproval: true })), /necesita tu aprobación/);
  assert.doesNotMatch(invoiceSummary(invoice('ESCALATE', ['HUMAN_APPROVAL_REQUIRED'])), /tu aprobación/);
  assert.match(invoiceSummary({ ...invoice('APPROVE', ['POLICY_ALLOWED']), status: 'FAILED' }), /No pude leer/);
});

test('empty emails give a concrete next step; multiple documents keep distinct private links and a bounded message', () => {
  const [empty] = emailNotice(env, { state: 'NO_DOCUMENT' }, []);
  assert.match(empty.text, /adjuntar.*pegar su imagen/);
  assert.equal(empty.reply_markup.inline_keyboard[0][0].url, 'https://oli.invalid/app/inbox');
  const inputs = Array.from({ length: 4 }, (_, n) => ({ ...invoice(n ? 'ESCALATE' : 'APPROVE', n ? ['INVALID_OR_MISSING_DATA'] : ['POLICY_ALLOWED']),
    id: `invoice-${n}`, vendorName: '🏷️'.repeat(300) + '\nQuedó aprobada.' }));
  const [part] = emailNotice(env, {}, inputs);
  assert.match(part.text, /4 documentos/); assert.ok(Array.from(part.text).length < 1800);
  assert.equal(part.reply_markup.inline_keyboard.length, 5);
  for (let n = 0; n < 4; n++) assert.equal(part.reply_markup.inline_keyboard[n][0].url, `https://oli.invalid/app/bills/invoice-${n}`);
  assert.equal(part.text.match(/Quedó aprobada/g).length, 1);
});

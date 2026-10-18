import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { DecisionTrace } from '../../src/components/DecisionTrace';
import { ExtractionPanel } from '../../src/components/ExtractionPanel';
import { InvoiceLogs } from '../../src/components/InvoiceLogs';
import { ExtractedInvoiceSchema, InvoiceDetailSchema, PolicyDecisionSchema } from '../../src/contracts';
import { applyLang } from '../../src/i18n';
import { extractionExplanation, invoiceExplanation, readingNeedsReview, unverifiedExtractionFields } from '../../src/lib/extraction-explanation';

const extracted = ExtractedInvoiceSchema.parse({
  vendorName: 'Empresa de logística, S. L.', invoiceNumber: '2024-0001',
  amountMinor: 153806, currency: 'EUR', issuedAt: '2024-04-17', dueDate: '2024-05-17', description: 'Producto 1',
  extractionWarnings: [
    'The line item descriptions are generic placeholders ("Producto 1", "Producto 2", "Producto 3") and do not describe the actual goods or services.',
    'The seller is identified only by the explicit counterparty heading "Empresa de logística, S. L."; no explicit Supplier/Proveedor/Emisor field is present.',
    ...['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'description'].map(field => `INDEPENDENT_READ_MISMATCH:${field}`),
  ],
  evidence: [{ field: 'amountMinor', source: 'page:1', quote: 'TOTAL: €1.538,06' }],
});
const decision = PolicyDecisionSchema.parse({
  decision: 'ESCALATE', reasons: ['INVALID_OR_MISSING_DATA'], needsHumanApproval: false,
  explanation: 'La extracción necesita corrección o corroboración; no permite autorización automática ni una excepción genérica.',
  trace: [{ rule: 'EXTRACTION', result: 'WARN', observed: 'La extracción necesita corrección o corroboración.',
    evidence: JSON.stringify({ status: 'REVIEW_REQUIRED', issues: 'EXTRACTION_WARNING:*, FIELD_MISMATCH:vendorName, FIELD_MISMATCH:amountMinor, FIELD_MISMATCH:currency, FIELD_MISMATCH:dueDate' }) }],
});

afterEach(() => applyLang('en'));

it('preserves read values and gives a concrete retry when checking is unavailable', () => {
  applyLang('es');
  const read = { ...extracted, extractionWarnings: ['INDEPENDENT_READ_UNAVAILABLE:*'] };
  const before = JSON.stringify(read);
  const messages = extractionExplanation(read, { rule: 'EXTRACTION', result: 'WARN', evidence: '{"issues":"CORROBORATION_REQUIRED:*"}' });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Leí los datos');
  expect(messages[0]).toContain('Volver a leer original');
  expect(messages[0]).toContain('Quedó en revisión');
  expect(messages.join(' ')).not.toMatch(/Qwen|429|INDEPENDENT|corrobor/i);
  expect(JSON.stringify(read)).toBe(before);
});

it('marks an inferred or differing currency as unchecked even when its value is present', () => {
  const read = { ...extracted, currency: 'USD', extractionWarnings: ['INDEPENDENT_READ_UNAVAILABLE:currency'] };
  expect([...unverifiedExtractionFields(read)]).toEqual(['currency']);
  expect(read.currency).toBe('USD');
  expect(unverifiedExtractionFields({ ...read, extractionWarnings: ['INDEPENDENT_READ_MISMATCH:currency'] }).has('currency')).toBe(true);
  expect(unverifiedExtractionFields({ ...read, extractionWarnings: [] }).size).toBe(0);
  expect(unverifiedExtractionFields({ ...read, extractionWarnings: ['INDEPENDENT_READ_UNAVAILABLE:*'] }).has('currency')).toBe(true);
});

it('explains the reported invoice in Spanish without architecture jargon or blaming the invoice', () => {
  applyLang('es');
  const before = JSON.stringify({ extracted, decision });
  const messages = extractionExplanation(extracted, decision.trace![0]).join(' ');
  expect(messages).toContain('Revisa estos datos');
  for (const field of ['Proveedor', 'Monto', 'Moneda', 'Fecha de vencimiento', 'Número de factura']) expect(messages).toContain(field);
  expect(messages).toContain('no significa que la factura esté mal');
  expect(messages).toContain('nombres genéricos');
  expect(messages).toContain('quién emite la factura');
  expect(invoiceExplanation(decision)).toContain('decidir si la apruebas');
  expect(messages).not.toMatch(/FIELD_MISMATCH|REVIEW_REQUIRED|INDEPENDENT_READ|segunda lectura|ambas lecturas|corroboraci[oó]n/i);
  expect(JSON.stringify({ extracted, decision })).toBe(before);
});

it('keeps technical data behind collapsed Logs and out of the readable panels', () => {
  applyLang('es');
  const panels = renderToStaticMarkup(createElement(DecisionTrace, { decision, extracted }))
    + renderToStaticMarkup(createElement(ExtractionPanel, { extracted }));
  expect(panels).not.toMatch(/FIELD_MISMATCH|REVIEW_REQUIRED|vendorName|amountMinor|page:1|generic placeholders|Evidencia verificada|no permite autorización/);
  expect(panels).toContain('Todavía no se comprobó si el proveedor está autorizado');
  const invoice = InvoiceDetailSchema.parse({ id: 'inv_test', status: 'DECIDED', source: 'HUMAN_UPLOAD', receivedAt: '2026-10-17T00:00:00Z', extracted, decision });
  const logs = renderToStaticMarkup(createElement(InvoiceLogs, { invoice }));
  expect(logs).toContain('<details id="invoice-logs"');
  expect(logs).not.toMatch(/<details[^>]*\sopen(?:[ =>])/);
  for (const technical of ['FIELD_MISMATCH', 'REVIEW_REQUIRED', 'vendorName', 'page:1', 'TOTAL: €1.538,06', 'generic placeholders']) expect(logs).toContain(technical);
});

it('distinguishes missing values and unavailable corroboration from differing readings', () => {
  const messages = extractionExplanation({ ...extracted, vendorName: null, extractionWarnings: [] }, {
    rule: 'EXTRACTION', result: 'WARN', evidence: JSON.stringify({ issues: 'MISSING_CRITICAL_FIELD:vendorName, CORROBORATION_REQUIRED:*' }),
  }).join(' ');
  expect(messages).toContain('could not read these required details: Vendor');
  expect(messages).toContain('could not finish checking the document');
  expect(messages).not.toContain('different one');
});

it.each(['{bad json', 'null', '[]', '"text"'])('handles unsupported evidence safely: %s', evidence => {
  const messages = extractionExplanation(null, { rule: 'EXTRACTION', result: 'WARN', evidence });
  expect(messages).toEqual(['I could not confirm all the invoice details. They need to be checked before approval.']);
});

it('preserves other blockers and does not relabel a date failure as a reading failure', () => {
  const blocked = { ...decision, reasons: ['INVALID_OR_MISSING_DATA', 'DUPLICATE_INVOICE'] };
  expect(invoiceExplanation(blocked)).toContain('Duplicate invoice');
  const dates = { ...decision, trace: [{ rule: 'EXTRACTION', result: 'PASS' as const }, { rule: 'INVOICE_DATES', result: 'WARN' as const }] };
  expect(readingNeedsReview(dates)).toBe(false);
  expect(invoiceExplanation(dates)).toBe(dates.explanation);
});

it('turns the measured issuer ambiguity into a concrete question without exposing architecture', () => {
  applyLang('es');
  const messages = extractionExplanation({ ...extracted, extractionWarnings: [
    "The seller/issuer identity is ambiguous: the document shows two parties, 'Orlando Juan Lobán' and 'Empresa de logística, S. L.', without an explicit supplier label.",
  ] }, { rule: 'EXTRACTION', result: 'WARN', evidence: '{"issues":"EXTRACTION_WARNING:*"}' }).join(' ');
  expect(messages).toContain('Confirma quién te está cobrando');
  expect(messages).not.toMatch(/lectur|corrobor|supplier|EXTRACTION_WARNING/i);
});

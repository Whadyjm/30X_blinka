import assert from 'node:assert/strict';
import test from 'node:test';
import { checkExtraction } from '@oli/contracts';
import { EXTRACTION_CONFIG_VERSION } from '@oli/extraction';
import { corroboratePdfText, parseMoneyMinor, parsePdfText, readDocument, READER_VERSION } from '../worker/document.js';

const hash = 'a'.repeat(64);
const bytes = new TextEncoder().encode('%PDF-1.4\nsynthetic document; provider calls mocked');
const pdf = { mimeType: 'application/pdf' };
const fields = { vendorName: 'Café Demo', invoiceNumber: 'INV-001', amountMinor: 999900, currency: 'USD',
  issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: '2026-10', description: 'Servicio mensual' };
const ex = (changes = {}) => ({ ...fields, extractionWarnings: [], evidence: [], ...changes });
const text = (changes = {}) => {
  const f = { ...fields, ...changes };
  return `EMISOR / SUPPLIER\n${f.vendorName ?? 'NO INDICADO'}\nCliente: Demo\nNúmero / Number\n${f.invoiceNumber ?? 'NO INDICADO'}\nEmisión / Issued\n${f.issuedAt ?? 'NO INDICADA'}\nVencimiento / Due\n${f.dueDate ?? 'NO INDICADO'}\nPeriodo de servicio\n${f.servicePeriod ?? 'NO INDICADO'}\nAcuerdo / Agreement\n${f.agreementReference ?? 'agr_demo_one'}\nMoneda / Currency\n${f.currency ?? 'NO INDICADA'}\nCONCEPTO / DESCRIPTION\n${f.description ?? 'NO INDICADO'}\nTOTAL A COBRAR\n${f.total ?? 'USD 9,999.00'}\nImporte final; sin cargos adicionales.`;
};
const wire = (extraction = ex()) => Response.json({ model: 'synthetic-test-model', provider: 'test',
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ documentType: 'INVOICE', ...extraction }) } }] });
const envFor = source => ({ OPENROUTER_API_KEY: 'test-only', AI: { toMarkdown: async () => ({ format: 'markdown', data: source }) } });
const checked = result => checkExtraction({ documentSha256: hash, primaryReadId: result.primaryReadId,
  candidate: result.extraction, corroboration: result.corroboration });

test('money parser is exact for both unambiguous locales and rejects ambiguity, malformed grouping, overflow and currencies', () => {
  for (const value of ['USD 9,999.00', 'USD 9.999,00', '9999.00', '9999,00']) assert.equal(parseMoneyMinor(value, 'USD'), 999900, value);
  assert.equal(parseMoneyMinor('USD 0.29', 'USD'), 29);
  assert.equal(parseMoneyMinor('USD 1,234,567.89', 'USD'), 123456789);
  assert.equal(parseMoneyMinor('USD 1.234.567,89', 'USD'), 123456789);
  assert.equal(parseMoneyMinor('USD 1,234,567', 'USD'), 123456700);
  assert.equal(parseMoneyMinor('JPY 1234', 'JPY'), 1234);
  assert.equal(parseMoneyMinor('KWD 1234.567', 'KWD'), 1234567);
  assert.equal(parseMoneyMinor('USD 90071992547409.91', 'USD'), Number.MAX_SAFE_INTEGER);
  for (const value of ['1,234', '1.234', 'USD 1,23,456.00', 'USD 1.23.456,00', 'USD 0', 'USD -1.00', 'USD 1e3',
    'USD 90071992547409.92', 'USD 1.001', 'USD 1.', '$ 99.00', 'EUR 99.00', 'USD 1,234.567', 'USD 1.234,567']) {
    assert.equal(parseMoneyMinor(value, 'USD'), null, value);
  }
  assert.equal(parseMoneyMinor('KWD 1.234', 'KWD'), null, 'three-decimal currency still does not prove locale');
  assert.equal(parseMoneyMinor('JPY 1234.00', 'JPY'), null);
  assert.equal(parseMoneyMinor('9.00', null), null);
});

test('independent labelled parser reads all eight fields and reference without candidate inputs; duplicates stay unknown', () => {
  assert.deepEqual(parsePdfText(text()), { fields, agreementReference: 'agr_demo_one', issues: [] });
  const joined = text().replace(/\n/g, '');
  assert.deepEqual(parsePdfText(joined), { fields, agreementReference: 'agr_demo_one', issues: [] });
  const multiline = text().replace('Servicio mensual', 'Servicio\nmensual');
  assert.equal(parsePdfText(multiline).fields.description, fields.description);
  for (const vendorName of ['Proveedor Bloqueado (ficticio)', 'Supplier Services', 'Moneda Demo']) {
    assert.equal(parsePdfText(text({ vendorName })).fields.vendorName, vendorName, 'generic words inside values are not labels');
  }
  assert.equal(parsePdfText(text().replace('EMISOR / SUPPLIER', 'Proveedor')).fields.vendorName, fields.vendorName);
  assert.equal(parsePdfText(text().replace('EMISOR / SUPPLIER\nCafé Demo', 'Proveedor: Café Demo')).fields.vendorName, fields.vendorName);
  for (const [field, label, value] of [['vendorName', 'EMISOR / SUPPLIER', 'Café Demo'], ['invoiceNumber', 'Número / Number', 'INV-001'],
    ['issuedAt', 'Emisión / Issued', '2026-10-01'], ['dueDate', 'Vencimiento / Due', '2026-10-31'],
    ['servicePeriod', 'Periodo de servicio', '2026-10'], ['currency', 'Moneda / Currency', 'USD'],
    ['description', 'CONCEPTO / DESCRIPTION', 'Servicio mensual'], ['amountMinor', 'TOTAL A COBRAR', 'USD 9,999.00']]) {
    assert.equal(parsePdfText(`${text()}\n${label}\n${value}`).fields[field], null, field);
  }
  assert.equal(parsePdfText(`${text()}\nAcuerdo / Agreement\nagr_demo_one`).agreementReference, null);
  assert.equal(parsePdfText(text({ agreementReference: 'NO INDICADO' })).agreementReference, null);
  assert.equal(parsePdfText(text({ agreementReference: 'agr with spaces' })).agreementReference, null);
  assert.deepEqual(parsePdfText(text({ agreementReference: 'agr with spaces' })).issues, ['INDEPENDENT_AGREEMENT_REFERENCE_UNCERTAIN']);
  assert.deepEqual(parsePdfText(`${text()}\nAcuerdo / Agreement\nagr_demo_one`).issues, ['INDEPENDENT_AGREEMENT_REFERENCE_UNCERTAIN']);
  assert.equal(parsePdfText(text({ issuedAt: '2026-02-30' })).fields.issuedAt, null);
  assert.equal(parsePdfText(text({ servicePeriod: '2026-13' })).fields.servicePeriod, null);
  assert.equal(parsePdfText(`${text()}\nOtro TOTAL: USD 280.00`).fields.amountMinor, null);
  assert.equal(parsePdfText('é'.repeat(70000)).fields.vendorName, null, 'limit is UTF-8 bytes');
  assert.deepEqual(corroboratePdfText(text(), hash).fields, { vendorName: fields.vendorName, amountMinor: fields.amountMinor,
    currency: fields.currency, dueDate: fields.dueDate });
});

test('both independent readers start together and checkpoint successful artifacts; complete matching document passes', { timeout: 3000 }, async t => {
  const primaryStarted = Promise.withResolvers(), secondaryStarted = Promise.withResolvers();
  const checkpoints = {};
  t.mock.method(globalThis, 'fetch', async () => {
    primaryStarted.resolve(); await secondaryStarted.promise; return wire({ ...ex(), advisories: ['SYNTHETIC_LABEL'] });
  });
  const env = envFor(text());
  env.AI.toMarkdown = async () => { secondaryStarted.resolve(); await primaryStarted.promise; return { format: 'markdown', data: text() }; };
  const result = await readDocument(env, pdf, bytes, hash, { checkpoint: async (kind, artifact) => { checkpoints[kind] = artifact; } });
  assert.equal(checked(result).status, 'CROSS_CHECKED');
  assert.equal(result.agreementReference, 'agr_demo_one');
  assert.equal(checkpoints.PRIMARY.result.extraction.extractionWarnings.length, 0);
  assert.deepEqual(checkpoints.SECONDARY.fields, fields);
  assert.deepEqual(result.provenance.advisories, ['SYNTHETIC_LABEL']);
  assert.deepEqual(result.provenance.cache, { PRIMARY: false, SECONDARY: false });
  assert.ok(READER_VERSION.includes(EXTRACTION_CONFIG_VERSION));
  assert.ok(result.provenance.timings.totalMs >= 0);
});

test('all eight independent disagreements append blocking warnings and original warnings survive', async t => {
  const changed = { vendorName: 'Other Demo', invoiceNumber: 'OTHER-002', amountMinor: 10000, currency: 'EUR',
    issuedAt: '2026-09-01', dueDate: '2026-09-30', servicePeriod: '2026-09', description: 'Other service' };
  t.mock.method(globalThis, 'fetch', async () => wire(ex({ ...changed, extractionWarnings: ['Original uncertain identity'] })));
  const result = await readDocument(envFor(text()), pdf, bytes, hash);
  assert.deepEqual(result.provenance.independentDisagreements, Object.keys(fields));
  assert.equal(result.extraction.extractionWarnings[0], 'Original uncertain identity');
  assert.equal(result.extraction.extractionWarnings.length, 9);
  assert.equal(checked(result).status, 'REVIEW_REQUIRED');
});

test('duplicate or malformed explicit agreement references block even when all extracted fields agree', async t => {
  t.mock.method(globalThis, 'fetch', async () => wire(ex()));
  for (const source of [text({ agreementReference: 'not a valid reference' }), `${text()}\nAcuerdo / Agreement\nagr_conflicting`]) {
    const result = await readDocument(envFor(source), pdf, bytes, hash);
    assert.equal(result.agreementReference, null);
    assert.ok(result.extraction.extractionWarnings.includes('INDEPENDENT_AGREEMENT_REFERENCE_UNCERTAIN'));
    assert.equal(checked(result).status, 'REVIEW_REQUIRED', 'must not silently fall back to matching a concept');
  }
});

test('number and Unicode text normalization compare equivalent facts; one missing side blocks, both null agree', async t => {
  t.mock.method(globalThis, 'fetch', async () => wire(ex({ vendorName: '  CAFE\u0301   DEMO ', invoiceNumber: 'ＩＮＶ / ００１',
    description: ' SERVICIO   MENSUAL ', issuedAt: null, servicePeriod: null })));
  const matching = await readDocument(envFor(text({ issuedAt: null, servicePeriod: null })), pdf, bytes, hash);
  assert.deepEqual(matching.provenance.independentDisagreements, []);
  const missing = await readDocument(envFor(text({ issuedAt: null, servicePeriod: null, description: null })), pdf, bytes, hash);
  assert.deepEqual(missing.provenance.independentDisagreements, ['description']);
  assert.equal(checked(missing).status, 'REVIEW_REQUIRED');
});

test('cached readers are reused separately, exact document/config/MIME invalidates artifacts, and comparison never mutates cached primary', async t => {
  const artifacts = {};
  let calls = 0, pdfCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return wire(ex()); });
  const env = envFor(text({ description: 'Different independent concept' }));
  const convert = env.AI.toMarkdown;
  env.AI.toMarkdown = async () => { pdfCalls++; return convert(); };
  const options = { artifacts, checkpoint: async (kind, value) => { artifacts[kind] = value; } };
  const first = await readDocument(env, pdf, bytes, hash, options);
  const second = await readDocument(env, pdf, bytes, hash, options);
  assert.deepEqual(second.provenance.cache, { PRIMARY: true, SECONDARY: true });
  assert.deepEqual(second.extraction.extractionWarnings, first.extraction.extractionWarnings);
  assert.deepEqual(artifacts.PRIMARY.result.extraction.extractionWarnings, []);
  assert.deepEqual([calls, pdfCalls], [1, 1]);
  delete artifacts.SECONDARY;
  await readDocument(env, pdf, bytes, hash, options);
  assert.deepEqual([calls, pdfCalls], [1, 2]);
  delete artifacts.PRIMARY;
  await readDocument(env, pdf, bytes, hash, options);
  assert.deepEqual([calls, pdfCalls], [2, 2]);
  artifacts.PRIMARY.readerVersion = 'obsolete'; artifacts.SECONDARY.mimeType = 'image/png';
  await readDocument(env, pdf, bytes, hash, options);
  assert.deepEqual([calls, pdfCalls], [3, 3]);
  artifacts.PRIMARY.documentSha256 = 'b'.repeat(64); artifacts.SECONDARY.documentSha256 = 'b'.repeat(64);
  await readDocument(env, pdf, bytes, hash, options);
  assert.deepEqual([calls, pdfCalls], [4, 4]);
});

test('primary failure waits for a successful secondary checkpoint; retry reuses it instead of converting twice', { timeout: 3000 }, async t => {
  const artifacts = {}, started = Promise.withResolvers(), release = Promise.withResolvers();
  let rejectProvider = true, conversions = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    started.resolve(); return rejectProvider ? Response.json({ error: { message: 'synthetic rejection' } }, { status: 400 }) : wire(ex());
  });
  const env = envFor(text());
  env.AI.toMarkdown = async () => { conversions++; await release.promise; return { format: 'markdown', data: text() }; };
  let finished = false;
  const failed = readDocument(env, pdf, bytes, hash, { checkpoint: async (kind, artifact) => { artifacts[kind] = artifact; } })
    .then(() => { finished = true; assert.fail('expected primary error'); }, error => { finished = true; return error; });
  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'secondary work/checkpoint must finish before throwing');
  release.resolve();
  assert.equal((await failed).code, 'OPENROUTER_REQUEST_REJECTED');
  assert.ok(artifacts.SECONDARY);
  assert.equal(artifacts.PRIMARY, undefined);
  rejectProvider = false;
  const retry = await readDocument(env, pdf, bytes, hash, { artifacts });
  assert.equal(retry.provenance.cache.SECONDARY, true);
  assert.equal(conversions, 1);
});

test('secondary transport failures retry with cached primary; absent AI and images remain review-only', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return wire(ex()); });
  const artifacts = {};
  const env = envFor('é'.repeat(70000));
  const options = { checkpoint: async (kind, artifact) => { artifacts[kind] = artifact; } };
  await assert.rejects(readDocument(env, pdf, bytes, hash, options), error => error.code === 'INDEPENDENT_READ_UNAVAILABLE'
    && error.diagnostic.issueCodes[0] === 'PDF_TEXT_UNAVAILABLE');
  assert.ok(artifacts.PRIMARY); assert.equal(artifacts.SECONDARY, undefined);
  env.AI.toMarkdown = async () => { throw new Error('synthetic transport error'); };
  await assert.rejects(readDocument(env, pdf, bytes, hash, { ...options, artifacts }), error => error.code === 'INDEPENDENT_READ_UNAVAILABLE');
  assert.equal(artifacts.SECONDARY, undefined);
  assert.equal(calls, 1, 'successful primary must not repeat for secondary transport retry');
  env.AI.toMarkdown = async () => ({ format: 'markdown', data: text() });
  const retry = await readDocument(env, pdf, bytes, hash, { ...options, artifacts });
  assert.equal(checked(retry).status, 'CROSS_CHECKED');
  assert.equal(calls, 1);
  const noAI = await readDocument({ OPENROUTER_API_KEY: 'test-only' }, pdf, bytes, hash);
  assert.equal(noAI.provenance.corroborationError, 'PDF_TEXT_UNAVAILABLE');
  assert.equal(checked(noAI).status, 'REVIEW_REQUIRED');
  const image = await readDocument(env, { mimeType: 'image/png' }, new Uint8Array([137,80,78,71,13,10,26,10]), hash);
  assert.equal(image.corroboration, null);
  assert.equal(image.provenance.corroborationError, 'INDEPENDENT_IMAGE_OCR_UNAVAILABLE');
  assert.equal(checked(image).status, 'REVIEW_REQUIRED');
});

test('secondary timeout is bounded and leaves no failed artifact cached', async t => {
  t.mock.method(globalThis, 'fetch', async () => wire(ex()));
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => originalTimeout(callback, delay === 15000 ? 1 : delay, ...args));
  const artifacts = {};
  const env = envFor(text()); env.AI.toMarkdown = () => new Promise(() => {});
  await assert.rejects(readDocument(env, pdf, bytes, hash, { checkpoint: async (kind, value) => { artifacts[kind] = value; } }),
    error => error.code === 'INDEPENDENT_READ_UNAVAILABLE' && error.diagnostic.issueCodes[0] === 'PDF_TEXT_TIMEOUT');
  assert.ok(artifacts.PRIMARY);
  assert.equal(artifacts.SECONDARY, undefined);
});

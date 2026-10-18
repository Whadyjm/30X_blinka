import { EXTRACTION_CONFIG_VERSION, IMAGE_OCR_CONFIG_VERSION, IMAGE_OCR_MODEL, ExtractionError, extractInvoiceWithOpenRouter, readImageWithOpenRouter, IndependentImageFieldsSchema } from '@oli/extraction';
import { CurrencySchema, DateSchema, DocumentTypeSchema, ExtractedInvoiceSchema, IdSchema, PeriodKeySchema } from '@oli/contracts';
import { normalizeInvoiceNumber } from '@oli/domain';
import { HttpError, id, sha256 } from './http.js';
import { meteredFetch, recordAiCall } from './ai-usage.js';

export function validateDocument(bytes, mimeType) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const pdf = new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (!((mimeType === 'image/png' && png) || (mimeType === 'image/jpeg' && jpeg) || (mimeType === 'application/pdf' && pdf))) {
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE');
  }
}

const PDF_PARSER_VERSION = 'labelled-v8';
export const READER_VERSION = `${PDF_PARSER_VERSION}:${EXTRACTION_CONFIG_VERSION}:${IMAGE_OCR_CONFIG_VERSION}`;
const MAX_TEXT_BYTES = 128 * 1024;
const referenceIssue = 'INDEPENDENT_AGREEMENT_REFERENCE_UNCERTAIN';
const ocrIssue = 'INDEPENDENT_OCR_UNCERTAIN';
const fieldNames = ['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'servicePeriod', 'description'];
const noFields = () => Object.fromEntries(fieldNames.map(field => [field, null]));
const normalizedText = value => value?.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() || null;

export function parseMoneyMinor(value, currency) {
  if (typeof value !== 'string' || !CurrencySchema.safeParse(currency).success) return null;
  const exponent = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const marked = value.trim().match(/^(?:([A-Z]{3})\s+|(€)\s*)?(\d[\d.,]*)(?:\s+([A-Z]{3})|\s*(€))?$/);
  if (!marked || [marked[1], marked[2] && 'EUR', marked[4], marked[5] && 'EUR'].filter(Boolean).some(code => code !== currency)) return null;
  const number = marked[3];
  if (number.length > 64 || !/^\d[\d.,]*$/.test(number)) return null;
  let integer = number, fraction = '';
  if (number.includes('.') && number.includes(',')) {
    const decimal = number.lastIndexOf('.') > number.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    const parts = number.split(decimal);
    if (parts.length !== 2 || !new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(parts[0])) return null;
    integer = parts[0].split(grouping).join(''); fraction = parts[1];
    if (!/^\d+$/.test(fraction)) return null;
  } else if (/[.,]/.test(number)) {
    const separator = number.includes('.') ? '.' : ',';
    const parts = number.split(separator);
    if (parts.length === 2) {
      // 1,234 / 1.234 can mean units or decimals; a currency exponent cannot prove the writer's locale.
      if (parts[1].length === 3 && parts[0].length <= 3) return null;
      integer = parts[0]; fraction = parts[1];
      if (!/^\d+$/.test(fraction)) return null;
    } else {
      if (!new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3}){2,}$`).test(number)) return null;
      integer = parts.join('');
    }
  }
  if (fraction.length > exponent) return null;
  const minor = BigInt(integer) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0');
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function totalCurrency(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:([A-Z]{3})\s+|(€)\s*)?\d[\d.,]*(?:\s+([A-Z]{3})|\s*(€))?$/);
  if (!match) return null;
  const codes = [match[1], match[2] && 'EUR', match[3], match[4] && 'EUR'].filter(Boolean);
  return codes.length && codes.every(code => code === codes[0]) ? codes[0] : null;
}

export function parseDocumentDate(value) {
  if (DateSchema.safeParse(value).success) return value;
  if (typeof value !== 'string') return null;
  const local = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!local) return null;
  const a = Number(local[1]), b = Number(local[2]);
  // Neither locale nor a model's preference resolves a genuinely ambiguous date.
  if (a <= 12 && b <= 12 && a !== b) return null;
  const day = a > 12 || a === b ? a : b, month = a > 12 || a === b ? b : a;
  const iso = `${local[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return DateSchema.safeParse(iso).success ? iso : null;
}

export function parseImageRead(ocr) {
  const raw = IndependentImageFieldsSchema.parse(ocr.fields);
  const fields = noFields();
  const original = normalizedText(ocr.text) ?? '';
  const literal = value => typeof value === 'string' && original.includes(normalizedText(value)) ? value : null;
  for (const field of ['vendorName', 'invoiceNumber', 'description']) fields[field] = literal(raw[field]);
  const total = literal(raw.total), markedCurrency = totalCurrency(total);
  const explicitCurrency = raw.currency && (new RegExp(`\\b${raw.currency}\\b`).test(ocr.text) || raw.currency === 'EUR' && ocr.text.includes('€')) ? raw.currency : null;
  fields.currency = markedCurrency && explicitCurrency && markedCurrency !== explicitCurrency ? null : markedCurrency ?? explicitCurrency;
  const currencyClaims = [...ocr.text.matchAll(/(?:^|\n)\s*(?:Moneda\s*\/\s*Currency|Moneda|Currency)\s*[:|]?\s*([A-Z]{3})(?=\s|$)/gi)].map(match => match[1].toUpperCase());
  if (currencyClaims.some(code => code !== fields.currency)) fields.currency = null;
  fields.amountMinor = parseMoneyMinor(total, fields.currency);
  for (const field of ['issuedAt', 'dueDate']) fields[field] = parseDocumentDate(literal(raw[field]));
  fields.servicePeriod = PeriodKeySchema.safeParse(literal(raw.servicePeriod)).success ? raw.servicePeriod : null;
  const reference = literal(raw.agreementReference);
  const agreementReference = reference && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(reference) ? reference : null;
  // Repeated explicit final totals remain uncertain even when the model chose one of them.
  if (ocr.text.split(/\r?\n/).filter(line => /^\s*(?:TOTAL(?: A COBRAR| DUE)?|INVOICE TOTAL)\s*[:|]?\s*(?:[A-Z]{3}\s+|€)?\d/i.test(line)).length > 1) fields.amountMinor = null;
  if (ocr.issues.includes('AMBIGUOUS_VENDOR')) fields.vendorName = null;
  if (ocr.issues.includes('CONFLICTING_TOTALS')) fields.amountMinor = null;
  return { fields, agreementReference, issues: ocr.issues.length ? [ocrIssue] : [] };
}

const labels = [
  ['vendorName', 'EMISOR\\s*\\/\\s*SUPPLIER|(?:Emisor|Vendedor|Facturado por)(?=\\s*[:|]|\\s*$)|Proveedor(?=\\s*[:|]|\\s*$)|Supplier(?=\\s*[:|]|\\s*$)'],
  ['client', 'Cliente\\s*:|Customer\\s*:'],
  ['invoiceNumber', 'N[úu]mero\\s*\\/\\s*Number|(?:Invoice number|N[úu]mero de factura|Factura n[úu]mero|N[úu]mero)(?=\\s*[:|]|\\s*$)'],
  ['issuedAt', 'Emisi[oó]n\\s*\\/\\s*Issued|(?:Issue date|Issued date|Fecha de factura|Fecha de emisi[oó]n|Emisi[oó]n)(?=\\s*[:|]|\\s*$)'],
  ['dueDate', 'Vencimiento\\s*\\/\\s*Due|Due date(?=\\s*[:|]|\\s*$)|Fecha de vencimiento(?=\\s*[:|]|\\s*$)|Vencimiento(?=\\s*[:|]|\\s*$)'],
  ['servicePeriod', 'Periodo de servicio|Service period(?=\\s*[:|]|\\s*$)'],
  ['agreementReference', 'Acuerdo\\s*\\/\\s*Agreement|(?:Agreement reference|Acuerdo)(?=\\s*[:|]|\\s*$)'],
  ['currency', 'Moneda\\s*\\/\\s*Currency|Currency(?=\\s*[:|]|\\s*$)|Moneda(?=\\s*[:|]|\\s*$)'],
  ['description', 'CONCEPTO\\s*\\/\\s*DESCRIPTION|(?:Description|Concepto)(?=\\s*[:|]|\\s*$)'],
  ['subtotal', 'Sub[\\s-]*total(?: a cobrar)?(?=\\s*[:|]|\\s*$)'],
  ['amountMinor', 'TOTAL A COBRAR|(?:Invoice total|Total(?: due)?)(?=\\s*[:|]|\\s*$)'],
  ['footer', 'Importe final\\s*;'],
  ['notes', 'Notes(?=\\s*:)|Notas(?=\\s*:)'],
];
// Split the corpus's compound labels even when vector text items touch. Generic aliases stay line-anchored.
const boundary = /EMISOR\s*\/\s*SUPPLIER|Cliente\s*:|N[úu]mero\s*\/\s*Number|Emisi[oó]n\s*\/\s*Issued|Vencimiento\s*\/\s*Due|Periodo de servicio|Acuerdo\s*\/\s*Agreement|Moneda\s*\/\s*Currency|CONCEPTO\s*\/\s*DESCRIPTION|Sub[\s-]*total(?: a cobrar)?\s*:|(?<!sub)TOTAL A COBRAR|Importe final\s*;/gi;
const labelPatterns = labels.map(([field, pattern]) => [field, new RegExp(`^(?:${pattern})\\s*(?:[:|]\\s*)*(.*)$`, 'i')]);
// Missing punctuation is supported only for whole, explicit lines. Never split these words inside values.
const bareLabelPatterns = [
  ['vendorName', /^Supplier\s+([^:|].*)$/i],
  ['invoiceNumber', /^Invoice number\s+([\p{L}\p{N}_.\/-]+)$/iu],
  ['issuedAt', /^(?:Issue date|Issued date)\s+([^:|].*)$/i],
  ['dueDate', /^Due date\s+([^:|].*)$/i],
  ['servicePeriod', /^Service period\s+([^:|].*)$/i],
  ['description', /^Description\s+([^:|].*)$/i],
  ['amountMinor', /^Total\s+([A-Z]{3}\s+\d.*)$/],
];
const clean = value => value.replace(/^[#*|\s]+|[*|\s]+$/g, '').trim();
const provided = value => value && !/^(?:NO INDICAD[OA]|N\/A|NOT PROVIDED|NONE|NULL)$/i.test(value) ? value : null;
const matchLabel = (line, allowBare = false) => [...labelPatterns, ...(allowBare ? bareLabelPatterns : [])]
  .map(([field, pattern]) => [field, line.match(pattern)]).find(([, match]) => match);
// Conversion can join separate PDF text items. Single-language labels require an explicit colon.
const colonBoundary = /(?:Proveedor|Supplier|Emisor|Vendedor|Facturado por|Cliente|Customer|Invoice number|N[úu]mero de factura|Factura n[úu]mero|N[úu]mero|Issue date|Issued date|Fecha de factura|Fecha de emisi[oó]n|Emisi[oó]n|Due date|Fecha de vencimiento|Vencimiento|Service period|Agreement reference|Acuerdo|Currency|Moneda|Description|Concepto|Sub[\s-]*total(?: a cobrar)?|(?<![\p{L}-])(?:Invoice total|Total)|(?:Invoice total|Total(?: due)?)(?=\s*:\s*(?:[A-Z]{3}\s+)?\d)|Notes|Notas)\s*:/giu;
const sectionBoundary = /Datos de prueba\b|P[áa]gina\s+\d+\s+de\s+\d+\b|Detalle de (?:servicio|factura)\b|Unidades\s+Precio\s+Importe\b|Horas\s*:|Fecha de entrega\s*:|Recibido\s*:/gi;

function pdfLines(text) {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').split(/\r?\n/).flatMap(line => {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map(clean);
      // Only explicit key/value rows; item tables and header rows carry no field authority.
      if (cells.length % 2 || cells.some((cell, i) => i % 2 === 0
        ? !matchLabel(cell) || matchLabel(cell)[1][1] !== '' : !cell || !!matchLabel(cell))) return ['', `UNPARSED_TABLE: ${line}`, ''];
      return cells.filter((_, i) => i % 2 === 0).map((cell, i) => `${cell.replace(/:$/, '')}: ${cells[i * 2 + 1]}`);
    }
    return line;
  }).flatMap(line => line.replace(boundary, match => `\n${match}`)
    .replace(colonBoundary, match => `\n${match}`)
    .replace(sectionBoundary, match => `\n${match}`).split('\n')).map(clean);
}

// shortcut: explicit labelled text/key-value tables only; scans and unfamiliar layouts require review.
// Each field comes exclusively from independent document text, never candidate values or fixture metadata.
export function parsePdfText(text) {
  const fields = noFields();
  if (typeof text !== 'string' || text.length > MAX_TEXT_BYTES || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return { fields, agreementReference: null, issues: [] };
  }
  const lines = pdfLines(text);
  const values = Object.fromEntries(labels.map(([field]) => [field, []]));
  let active = null, page = 0;
  for (const line of lines) {
    if (!line && active && !values[active].at(-1).value.trim()) continue;
    if (/^Page\s+\d+$/i.test(line)) { page++; active = null; continue; }
    if (!line || /^(?:Datos de prueba\b|P[áa]gina\s+\d+\s+de\s+\d+\b|Detalle de (?:servicio|factura)\b|Unidades\s+Precio\s+Importe\b)/i.test(line)) {
      active = null; continue;
    }
    // A pending multiline value (e.g. supplier "Supplier Services") remains a value.
    const labelled = matchLabel(line, !active || !!values[active].at(-1).value.trim());
    if (labelled) {
      active = labelled[0]; values[active].push({ value: labelled[1][1], page });
    } else if (/^[\p{L}][^:]{0,60}:/u.test(line)) {
      active = null;
    } else if (active) {
      const chunks = values[active]; chunks[chunks.length - 1].value += ` ${line}`;
    }
  }
  const unique = field => {
    const entries = values[field];
    if (entries.length === 1) return provided(clean(entries[0].value));
    // Repeated page headers/descriptions may agree; same-page duplicates and monetary claims stay uncertain.
    if (!['vendorName', 'invoiceNumber', 'description'].includes(field) || !entries.length
      || entries.some(entry => entry.page === 0) || new Set(entries.map(entry => entry.page)).size !== entries.length) return null;
    const candidates = entries.map(entry => provided(clean(entry.value)));
    return candidates.every(value => value === candidates[0]) ? candidates[0] : null;
  };
  fields.vendorName = unique('vendorName');
  fields.invoiceNumber = unique('invoiceNumber');
  fields.description = unique('description');
  for (const [field, schema] of [['currency', CurrencySchema], ['issuedAt', DateSchema], ['dueDate', DateSchema], ['servicePeriod', PeriodKeySchema]]) {
    const value = unique(field); fields[field] = ['issuedAt', 'dueDate'].includes(field) ? parseDocumentDate(value) : schema.safeParse(value).success ? value : null;
  }
  const totalCurrencies = values.amountMinor.map(entry => totalCurrency(provided(clean(entry.value))));
  if (!values.currency.length && totalCurrencies.length && totalCurrencies.every(value => value === totalCurrencies[0])
    && CurrencySchema.safeParse(totalCurrencies[0]).success) fields.currency = totalCurrencies[0];
  if (totalCurrencies.some(value => value && value !== fields.currency)) fields.currency = null;
  fields.amountMinor = parseMoneyMinor(unique('amountMinor'), fields.currency);
  // Any competing total claim stays ambiguous, including a second total in free-form notes.
  if (lines.reduce((count, line) => count + [...line.matchAll(/\btotal\b/gi)].length, 0) !== 1) fields.amountMinor = null;
  const reference = unique('agreementReference');
  const validReference = reference && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(reference) ? reference : null;
  const uncertainReference = values.agreementReference.length > 1 || (!!reference && !validReference);
  return { fields, agreementReference: validReference, issues: uncertainReference ? [referenceIssue] : [] };
}
function corroborationFor(secondary, documentSha256) {
  const { vendorName, amountMinor, currency, dueDate } = secondary.fields;
  return { documentSha256, readId: secondary.readId, method: secondary.method ?? 'PDF_TEXT', fields: { vendorName, amountMinor, currency, dueDate } };
}
export function corroboratePdfText(text, documentSha256) {
  return corroborationFor({ ...parsePdfText(text), readId: id('pdftext') }, documentSha256);
}

function validArtifact(artifact, kind, documentSha256, mimeType) {
  if (!artifact || artifact.readerVersion !== READER_VERSION || artifact.documentSha256 !== documentSha256 || artifact.mimeType !== mimeType) return null;
  if (kind === 'PRIMARY') {
    if (artifact.result?.documentSha256 !== documentSha256 || artifact.result?.configVersion !== EXTRACTION_CONFIG_VERSION
      || !DocumentTypeSchema.safeParse(artifact.result?.documentType).success
      || !IdSchema.safeParse(artifact.result?.readId).success || !ExtractedInvoiceSchema.safeParse(artifact.result?.extraction).success) return null;
  } else {
    if (!IdSchema.safeParse(artifact.readId).success || !ExtractedInvoiceSchema.safeParse({ ...artifact.fields, extractionWarnings: [], evidence: [] }).success
      || !(artifact.agreementReference === null || (typeof artifact.agreementReference === 'string' && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(artifact.agreementReference)))
      || !Array.isArray(artifact.issues) || artifact.issues.some(issue => ![referenceIssue, ocrIssue].includes(issue))) return null;
    if (mimeType === 'application/pdf') {
      if (artifact.method !== 'PDF_TEXT' || typeof artifact.pdfText?.text !== 'string'
        || new TextEncoder().encode(artifact.pdfText.text).length > MAX_TEXT_BYTES
        || !/^[a-f0-9]{64}$/.test(artifact.pdfText.sha256)) return null;
    } else if (artifact.method !== 'OCR' || artifact.ocr?.model !== IMAGE_OCR_MODEL
      || artifact.ocr.configVersion !== IMAGE_OCR_CONFIG_VERSION || artifact.ocr.documentSha256 !== documentSha256
      || artifact.ocr.readId !== artifact.readId || typeof artifact.ocr.text !== 'string'
      || !artifact.ocr.text.trim() || !IndependentImageFieldsSchema.safeParse(artifact.ocr.fields).success || !Array.isArray(artifact.ocr.issues)
      || artifact.ocr.issues.some(issue => !['ILLEGIBLE_TEXT', 'AMBIGUOUS_LAYOUT', 'CROPPED_DOCUMENT', 'AMBIGUOUS_VENDOR', 'CONFLICTING_TOTALS', 'AMBIGUOUS_DATE'].includes(issue))
      || new TextEncoder().encode(artifact.ocr.text).length > MAX_TEXT_BYTES) return null;
  }
  return artifact;
}
async function readPdfText(env, bytes) {
  let timer;
  try {
    const result = await Promise.race([
      env.AI.toMarkdown({ name: 'invoice.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) },
        { conversionOptions: { pdf: { metadata: false } } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF_TEXT_TIMEOUT')), 15000); }),
    ]);
    if (Array.isArray(result) && result.length !== 1) throw new Error('PDF_TEXT_UNAVAILABLE');
    const output = Array.isArray(result) ? result[0] : result;
    if (output?.format === 'error' || typeof output?.data !== 'string' || output.data.length > MAX_TEXT_BYTES
      || new TextEncoder().encode(output.data).length > MAX_TEXT_BYTES) throw new Error('PDF_TEXT_UNAVAILABLE');
    return { ...parsePdfText(output.data), pdfText: { text: output.data, sha256: await sha256(output.data),
      converter: 'WORKERS_AI_TO_MARKDOWN' } };
  } finally { clearTimeout(timer); }
}

export async function readDocument(env, file, bytes, documentSha256, options = {}) {
  validateDocument(bytes, file.mimeType);
  const pdf = file.mimeType === 'application/pdf';
  const imageOcr = !pdf && ['SHADOW', 'ENABLED'].includes(env.IMAGE_OCR_MODE);
  const started = performance.now();
  const readerDependencies = category => ({ onHttpError: options.onHttpError,
    ...(options.orgId ? { fetch: meteredFetch(env.DB, options.orgId, category) } : {}) });
  const cached = {
    PRIMARY: validArtifact(options.artifacts?.PRIMARY, 'PRIMARY', documentSha256, file.mimeType),
    SECONDARY: pdf || imageOcr ? validArtifact(options.artifacts?.SECONDARY, 'SECONDARY', documentSha256, file.mimeType) : null,
  };
  const primaryTask = async () => {
    if (cached.PRIMARY) return cached.PRIMARY;
    const began = performance.now();
    const result = await extractInvoiceWithOpenRouter({ apiKey: env.OPENROUTER_API_KEY, documentSha256,
      images: pdf ? [] : [{ mimeType: file.mimeType, bytes }], ...(pdf ? { pdf: { bytes } } : {}) }, readerDependencies('INVOICE_EXTRACTION'));
    const artifact = { readerVersion: READER_VERSION, documentSha256, mimeType: file.mimeType, result,
      durationMs: Math.round(performance.now() - began) };
    await options.checkpoint?.('PRIMARY', artifact);
    return artifact;
  };
  const secondaryTask = async () => {
    if (cached.SECONDARY) return cached.SECONDARY;
    if (imageOcr) {
      const began = performance.now();
      const ocr = await readImageWithOpenRouter({ apiKey: env.OPENROUTER_API_KEY, documentSha256,
        image: { mimeType: file.mimeType, bytes } }, readerDependencies('INVOICE_OCR'));
      const parsed = parseImageRead(ocr);
      if (ocr.issues.length || /\[ILLEGIBLE\]/i.test(ocr.text)) parsed.issues.push(ocrIssue);
      const artifact = { readerVersion: READER_VERSION, documentSha256, mimeType: file.mimeType,
        readId: ocr.readId, method: 'OCR', ...parsed, ocr, durationMs: Math.round(performance.now() - began) };
      await options.checkpoint?.('SECONDARY', artifact);
      return artifact;
    }
    if (!pdf || !env.AI) return null;
    const began = performance.now();
    let parsed;
    try { parsed = await (options.orgId
      ? recordAiCall(env.DB, options.orgId, 'PDF_CONVERSION', 'workers-ai/toMarkdown', () => readPdfText(env, bytes))
      : readPdfText(env, bytes)); }
    catch (error) { return { error: error?.message === 'PDF_TEXT_TIMEOUT' ? 'PDF_TEXT_TIMEOUT' : 'PDF_TEXT_UNAVAILABLE' }; }
    const artifact = { readerVersion: READER_VERSION, documentSha256, mimeType: file.mimeType, readId: id('pdftext'), method: 'PDF_TEXT',
      ...parsed, durationMs: Math.round(performance.now() - began) };
    await options.checkpoint?.('SECONDARY', artifact);
    return artifact;
  };
  const [primaryResult, secondaryResult] = await Promise.allSettled([primaryTask(), secondaryTask()]);
  // Wait for both checkpoints before propagating failure, preserving a successful independent read for retry.
  if (primaryResult.status === 'rejected') throw primaryResult.reason;
  const primary = primaryResult.value.result;
  const separateRead = secondaryResult.status === 'fulfilled' ? secondaryResult.value : null;
  const secondaryFailure = secondaryResult.status === 'rejected' ? secondaryResult.reason : null;
  const secondaryError = secondaryFailure ? 'INDEPENDENT_READ_UNAVAILABLE' : separateRead?.error ?? null;
  const secondary = separateRead?.fields ? separateRead : null;
  if (secondary?.ocr && primary.model === secondary.ocr.model) throw new ExtractionError('INVALID_OUTPUT', secondary.ocr.attempts,
    { stage: 'IMAGE_OCR', issueCodes: ['SAME_READER_MODEL'] });
  const extraction = ExtractedInvoiceSchema.parse(primary.extraction);
  if (secondaryError) extraction.extractionWarnings.push('INDEPENDENT_READ_UNAVAILABLE:*');
  const discrepancies = secondary ? fieldNames.filter(field => {
    const primaryValue = extraction[field], separateValue = secondary.fields[field];
    if (primaryValue === null || separateValue === null) return false;
    if (field === 'vendorName' || field === 'description') return normalizedText(primaryValue) !== normalizedText(separateValue);
    if (field === 'invoiceNumber') return normalizeInvoiceNumber(primaryValue) !== normalizeInvoiceNumber(separateValue);
    return primaryValue !== separateValue;
  }) : [];
  const unavailable = secondary ? fieldNames.filter(field => extraction[field] !== null && secondary.fields[field] === null) : [];
  extraction.extractionWarnings.push(...(secondary?.issues ?? []), ...discrepancies.map(field => `INDEPENDENT_READ_MISMATCH:${field}`),
    ...unavailable.map(field => `INDEPENDENT_READ_UNAVAILABLE:${field}`));
  if (imageOcr && env.IMAGE_OCR_MODE !== 'ENABLED') extraction.extractionWarnings.push('INDEPENDENT_IMAGE_OCR_SHADOW');
  return { extraction, documentType: DocumentTypeSchema.parse(primary.documentType), primaryReadId: primary.readId, documentSha256, corroboration: secondary ? corroborationFor(secondary, documentSha256) : null,
    agreementReference: secondary?.agreementReference ?? null,
    provenance: { model: primary.model, provider: primary.provider, pdfTextParser: pdf ? PDF_PARSER_VERSION : null,
      documentClassification: { documentType: primary.documentType, source: 'PRIMARY_READER',
        documentSha256, primaryReadId: primary.readId, version: READER_VERSION },
      configVersion: READER_VERSION, attempts: primary.attempts, usage: primary.usage, advisories: primary.advisories ?? [],
      imageOcr: secondary?.ocr ?? null, imageOcrMode: imageOcr ? env.IMAGE_OCR_MODE : 'OFF', pdfText: secondary?.pdfText ?? null,
      corroborationError: secondary ? null : secondaryError ?? (pdf ? 'PDF_TEXT_UNAVAILABLE' : 'INDEPENDENT_IMAGE_OCR_UNAVAILABLE'),
      secondaryAttempts: secondaryFailure instanceof ExtractionError ? secondaryFailure.attempts : [],
      independentDisagreements: discrepancies, independentUnavailable: unavailable, independentIssues: secondary?.issues ?? [], cache: { PRIMARY: !!cached.PRIMARY, SECONDARY: !!cached.SECONDARY },
      timings: { totalMs: Math.round(performance.now() - started), primaryMs: primaryResult.value.durationMs, secondaryMs: secondary?.durationMs ?? null } } };
}

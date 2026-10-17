import { EXTRACTION_CONFIG_VERSION, ExtractionError, extractInvoiceWithOpenRouter } from '@oli/extraction';
import { CurrencySchema, DateSchema, DocumentTypeSchema, ExtractedInvoiceSchema, IdSchema, PeriodKeySchema } from '@oli/contracts';
import { normalizeInvoiceNumber } from '@oli/domain';
import { HttpError, id } from './http.js';

export function validateDocument(bytes, mimeType) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const pdf = new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (!((mimeType === 'image/png' && png) || (mimeType === 'image/jpeg' && jpeg) || (mimeType === 'application/pdf' && pdf))) {
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE');
  }
}

export const READER_VERSION = `labelled-v4:${EXTRACTION_CONFIG_VERSION}`;
const MAX_TEXT_BYTES = 128 * 1024;
const referenceIssue = 'INDEPENDENT_AGREEMENT_REFERENCE_UNCERTAIN';
const fieldNames = ['vendorName', 'invoiceNumber', 'amountMinor', 'currency', 'issuedAt', 'dueDate', 'servicePeriod', 'description'];
const noFields = () => Object.fromEntries(fieldNames.map(field => [field, null]));
const normalizedText = value => value?.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() || null;

export function parseMoneyMinor(value, currency) {
  if (typeof value !== 'string' || !CurrencySchema.safeParse(currency).success) return null;
  const exponent = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const prefixed = value.trim().match(/^([A-Z]{3})\s+(.+)$/);
  if (prefixed && prefixed[1] !== currency) return null;
  const number = prefixed ? prefixed[2] : value.trim();
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

const labels = [
  ['vendorName', 'EMISOR\\s*\\/\\s*SUPPLIER|Proveedor(?=\\s*[:|]|\\s*$)|Supplier(?=\\s*[:|]|\\s*$)'],
  ['client', 'Cliente\\s*:|Customer\\s*:'],
  ['invoiceNumber', 'N[úu]mero\\s*\\/\\s*Number|Invoice number(?=\\s*[:|]|\\s*$)'],
  ['issuedAt', 'Emisi[oó]n\\s*\\/\\s*Issued|Issue date(?=\\s*[:|]|\\s*$)|Issued date(?=\\s*[:|]|\\s*$)'],
  ['dueDate', 'Vencimiento\\s*\\/\\s*Due|Due date(?=\\s*[:|]|\\s*$)|Vencimiento(?=\\s*[:|]|\\s*$)'],
  ['servicePeriod', 'Periodo de servicio|Service period(?=\\s*[:|]|\\s*$)'],
  ['agreementReference', 'Acuerdo\\s*\\/\\s*Agreement|Agreement reference(?=\\s*[:|]|\\s*$)'],
  ['currency', 'Moneda\\s*\\/\\s*Currency|Currency(?=\\s*[:|]|\\s*$)|Moneda(?=\\s*[:|]|\\s*$)'],
  ['description', 'CONCEPTO\\s*\\/\\s*DESCRIPTION|Description(?=\\s*[:|]|\\s*$)'],
  ['amountMinor', 'TOTAL A COBRAR|Invoice total(?=\\s*[:|]|\\s*$)|Total(?=\\s*[:|]|\\s*$)'],
  ['footer', 'Importe final\\s*;'],
];
// Split the corpus's compound labels even when vector text items touch. Generic aliases stay line-anchored.
const boundary = /EMISOR\s*\/\s*SUPPLIER|Cliente\s*:|N[úu]mero\s*\/\s*Number|Emisi[oó]n\s*\/\s*Issued|Vencimiento\s*\/\s*Due|Periodo de servicio|Acuerdo\s*\/\s*Agreement|Moneda\s*\/\s*Currency|CONCEPTO\s*\/\s*DESCRIPTION|TOTAL A COBRAR|Importe final\s*;/gi;
const labelPatterns = labels.map(([field, pattern]) => [field, new RegExp(`^(?:${pattern})\\s*[:|]?\\s*(.*)$`, 'i')]);
const clean = value => value.replace(/^[#*|\s]+|[*|\s]+$/g, '').trim();
const provided = value => value && !/^(?:NO INDICAD[OA]|N\/A|NOT PROVIDED|NONE|NULL)$/i.test(value) ? value : null;

// shortcut: explicit labelled PDF layouts only; scans and unfamiliar layouts require review.
// Each field comes exclusively from independent document text, never candidate values or fixture metadata.
export function parsePdfText(text) {
  const fields = noFields();
  if (typeof text !== 'string' || text.length > MAX_TEXT_BYTES || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return { fields, agreementReference: null, issues: [] };
  }
  const lines = text.replace(boundary, match => `\n${match}`).split(/\r?\n/).map(clean).filter(Boolean);
  const values = Object.fromEntries(labels.map(([field]) => [field, []]));
  let active = null;
  for (const line of lines) {
    const labelled = labelPatterns.map(([field, pattern]) => [field, line.match(pattern)]).find(([, match]) => match);
    if (labelled) {
      active = labelled[0]; values[active].push(labelled[1][1]);
    } else if (active) {
      const chunks = values[active]; chunks[chunks.length - 1] += ` ${line}`;
    }
  }
  const unique = field => values[field].length === 1 ? provided(clean(values[field][0])) : null;
  fields.vendorName = unique('vendorName');
  fields.invoiceNumber = unique('invoiceNumber');
  fields.description = unique('description');
  for (const [field, schema] of [['currency', CurrencySchema], ['issuedAt', DateSchema], ['dueDate', DateSchema], ['servicePeriod', PeriodKeySchema]]) {
    const value = unique(field); fields[field] = schema.safeParse(value).success ? value : null;
  }
  fields.amountMinor = parseMoneyMinor(unique('amountMinor'), fields.currency);
  // Any competing total claim stays ambiguous, including a second total in free-form notes.
  if (lines.filter(line => /\btotal\b/i.test(line)).length !== 1) fields.amountMinor = null;
  const reference = unique('agreementReference');
  const validReference = reference && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(reference) ? reference : null;
  const uncertainReference = values.agreementReference.length > 1 || (!!reference && !validReference);
  return { fields, agreementReference: validReference, issues: uncertainReference ? [referenceIssue] : [] };
}
function corroborationFor(secondary, documentSha256) {
  const { vendorName, amountMinor, currency, dueDate } = secondary.fields;
  return { documentSha256, readId: secondary.readId, method: 'PDF_TEXT', fields: { vendorName, amountMinor, currency, dueDate } };
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
      || !Array.isArray(artifact.issues) || artifact.issues.some(issue => issue !== referenceIssue)) return null;
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
    return parsePdfText(output.data);
  } finally { clearTimeout(timer); }
}

export async function readDocument(env, file, bytes, documentSha256, options = {}) {
  validateDocument(bytes, file.mimeType);
  const pdf = file.mimeType === 'application/pdf';
  const started = performance.now();
  const cached = {
    PRIMARY: validArtifact(options.artifacts?.PRIMARY, 'PRIMARY', documentSha256, file.mimeType),
    SECONDARY: pdf ? validArtifact(options.artifacts?.SECONDARY, 'SECONDARY', documentSha256, file.mimeType) : null,
  };
  const primaryTask = async () => {
    if (cached.PRIMARY) return cached.PRIMARY;
    const began = performance.now();
    const result = await extractInvoiceWithOpenRouter({ apiKey: env.OPENROUTER_API_KEY, documentSha256,
      images: pdf ? [] : [{ mimeType: file.mimeType, bytes }], ...(pdf ? { pdf: { bytes } } : {}) });
    const artifact = { readerVersion: READER_VERSION, documentSha256, mimeType: file.mimeType, result,
      durationMs: Math.round(performance.now() - began) };
    await options.checkpoint?.('PRIMARY', artifact);
    return artifact;
  };
  const secondaryTask = async () => {
    if (cached.SECONDARY) return cached.SECONDARY;
    if (!pdf || !env.AI) return null;
    const began = performance.now();
    let parsed;
    try { parsed = await readPdfText(env, bytes); }
    catch (error) { return { error: error?.message === 'PDF_TEXT_TIMEOUT' ? 'PDF_TEXT_TIMEOUT' : 'PDF_TEXT_UNAVAILABLE' }; }
    const artifact = { readerVersion: READER_VERSION, documentSha256, mimeType: file.mimeType, readId: id('pdftext'),
      ...parsed, durationMs: Math.round(performance.now() - began) };
    await options.checkpoint?.('SECONDARY', artifact);
    return artifact;
  };
  const [primaryResult, secondaryResult] = await Promise.allSettled([primaryTask(), secondaryTask()]);
  // Wait for both checkpoints before propagating failure, preserving a successful independent read for retry.
  if (primaryResult.status === 'rejected') throw primaryResult.reason;
  if (secondaryResult.status === 'rejected') throw secondaryResult.reason;
  const primary = primaryResult.value.result;
  if (secondaryResult.value?.error) throw new ExtractionError('INDEPENDENT_READ_UNAVAILABLE', primary.attempts ?? [],
    { stage: 'SECONDARY', issueCodes: [secondaryResult.value.error] });
  const secondary = secondaryResult.value?.fields ? secondaryResult.value : null;
  const extraction = ExtractedInvoiceSchema.parse(primary.extraction);
  const discrepancies = secondary ? fieldNames.filter(field => {
    const primaryValue = extraction[field], separateValue = secondary.fields[field];
    if (field === 'vendorName' || field === 'description') return normalizedText(primaryValue) !== normalizedText(separateValue);
    if (field === 'invoiceNumber') return normalizeInvoiceNumber(primaryValue) !== normalizeInvoiceNumber(separateValue);
    return primaryValue !== separateValue;
  }) : [];
  extraction.extractionWarnings.push(...(secondary?.issues ?? []), ...discrepancies.map(field => `INDEPENDENT_READ_MISMATCH:${field}`));
  return { extraction, documentType: DocumentTypeSchema.parse(primary.documentType), primaryReadId: primary.readId, documentSha256, corroboration: secondary ? corroborationFor(secondary, documentSha256) : null,
    agreementReference: secondary?.agreementReference ?? null,
    provenance: { model: primary.model, provider: primary.provider, pdfTextParser: pdf ? 'labelled-v4' : null,
      documentClassification: { documentType: primary.documentType, source: 'PRIMARY_READER',
        documentSha256, primaryReadId: primary.readId, version: READER_VERSION },
      configVersion: READER_VERSION, attempts: primary.attempts, usage: primary.usage, advisories: primary.advisories ?? [],
      corroborationError: secondary ? null : secondaryResult.value?.error ?? (pdf ? 'PDF_TEXT_UNAVAILABLE' : 'INDEPENDENT_IMAGE_OCR_UNAVAILABLE'),
      independentDisagreements: discrepancies, independentIssues: secondary?.issues ?? [], cache: { PRIMARY: !!cached.PRIMARY, SECONDARY: !!cached.SECONDARY },
      timings: { totalMs: Math.round(performance.now() - started), primaryMs: primaryResult.value.durationMs, secondaryMs: secondary?.durationMs ?? null } } };
}

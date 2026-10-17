import { extractInvoiceWithOpenRouter } from '@oli/extraction';
import { CurrencySchema, DateSchema, ExtractedInvoiceSchema } from '@oli/contracts';
import { HttpError, id } from './http.js';

export function validateDocument(bytes, mimeType) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const pdf = new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (!((mimeType === 'image/png' && png) || (mimeType === 'image/jpeg' && jpeg) || (mimeType === 'application/pdf' && pdf))) {
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE');
  }
}

// shortcut: conservative labelled PDF text only; unfamiliar layouts and scans require review.
// Never use candidate values, expected fixtures, or model quotes to populate this read.
export function corroboratePdfText(text, documentSha256) {
  // Untagged vector PDFs can arrive with adjacent text items concatenated by toMarkdown.
  // Split known labels, not candidate values; duplicate labels remain ambiguous.
  const labels = /EMISOR\s*\/\s*SUPPLIER|Cliente\s*:|N[úu]mero\s*\/\s*Number|Emisi[oó]n\s*\/\s*Issued|Vencimiento\s*\/\s*Due|Periodo de servicio|Acuerdo\s*\/\s*Agreement|Moneda\s*\/\s*Currency|CONCEPTO\s*\/\s*DESCRIPTION|TOTAL A COBRAR|Importe final\s*;/gi;
  const labelledText = text.replace(labels, match => `\n${match}`);
  const lines = labelledText.split(/\r?\n/).map(s => s.replace(/^[#*\s]+|[*\s]+$/g, '').trim()).filter(Boolean);
  const uniqueAfter = (label) => {
    const values = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(label);
      if (match) values.push(match[1]?.trim() || lines[i + 1] || '');
    }
    return values.length === 1 ? values[0] : null;
  };
  const vendorName = uniqueAfter(/^(?:EMISOR\s*\/\s*SUPPLIER|Proveedor|Supplier)\s*:?\s*(.*)$/i);
  const currencyText = uniqueAfter(/^(?:Moneda\s*\/\s*Currency|Currency|Moneda)\s*:?\s*(.*)$/i);
  const currency = CurrencySchema.safeParse(currencyText).success ? currencyText : null;
  const dueText = uniqueAfter(/^(?:Vencimiento\s*\/\s*Due|Due date|Vencimiento)\s*:?\s*(.*)$/i);
  const dueDate = DateSchema.safeParse(dueText).success ? dueText : null;
  const total = uniqueAfter(/^(?:TOTAL A COBRAR|Invoice total|Total)\s*:?\s*(.*)$/i);
  let amountMinor = null;
  if (currency && total) {
    const match = total.match(/^([A-Z]{3})\s+([0-9]+)(?:\.([0-9]+))?$/);
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    if (match && match[1] === currency && (match[3]?.length ?? 0) <= digits) {
      const value = BigInt(match[2]) * 10n ** BigInt(digits) + BigInt((match[3] ?? '').padEnd(digits, '0') || '0');
      if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) amountMinor = Number(value);
    }
  }
  // Conflicting/extra total claims invalidate corroboration even if one label looks right.
  const totalClaims = lines.filter(line => /\btotal\b/i.test(line));
  if (totalClaims.length !== 1) amountMinor = null;
  return { documentSha256, readId: id('pdftext'), method: 'PDF_TEXT', fields: {
    vendorName: vendorName && !/^NO INDICAD/i.test(vendorName) ? vendorName : null, amountMinor, currency, dueDate,
  } };
}

export async function readDocument(env, file, bytes, documentSha256) {
  validateDocument(bytes, file.mimeType);
  const pdf = file.mimeType === 'application/pdf';
  const primary = await extractInvoiceWithOpenRouter({ apiKey: env.OPENROUTER_API_KEY, documentSha256,
    images: pdf ? [] : [{ mimeType: file.mimeType, bytes }], ...(pdf ? { pdf: { bytes } } : {}) });
  let corroboration = null;
  let corroborationError = null;
  if (pdf && env.AI) {
    let timer;
    try {
      const result = await Promise.race([
        env.AI.toMarkdown({ name: 'invoice.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) },
          { conversionOptions: { pdf: { metadata: false } } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF_TEXT_TIMEOUT')), 15000); }),
      ]);
      const output = Array.isArray(result) ? result[0] : result;
      if (output?.format !== 'error' && typeof output?.data === 'string' && output.data.length <= 128 * 1024) {
        corroboration = corroboratePdfText(output.data, documentSha256);
      } else corroborationError = 'PDF_TEXT_UNAVAILABLE';
    } catch { corroborationError = 'PDF_TEXT_UNAVAILABLE'; }
    finally { clearTimeout(timer); }
  } else corroborationError = pdf ? 'PDF_TEXT_UNAVAILABLE' : 'INDEPENDENT_IMAGE_OCR_UNAVAILABLE';
  return { extraction: ExtractedInvoiceSchema.parse(primary.extraction), primaryReadId: primary.readId,
    documentSha256, corroboration, provenance: { model: primary.model, provider: primary.provider, pdfTextParser: pdf ? 'labelled-v1' : null,
      attempts: primary.attempts, usage: primary.usage, corroborationError } };
}

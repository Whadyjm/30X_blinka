import { ExtractedInvoiceSchema } from '@oli/contracts';
import { EXTRACTION_MODELS } from '@oli/extraction';

const receiptWarning = 'Document is a mobile payment receipt, not an invoice; no invoice number, vendor, or due date present.';
const missingTotalWarning = 'No explicit invoice total, subtotal, or tax breakdown is present.';
const missingCurrencyWarning = /^Amount '[A-Za-z.]{1,8} [0-9][0-9.,]{0,30}' has no explicit ISO currency code; currency cannot be determined, so amountMinor is null\.$/;

// Explicit reanalysis only: this historical assertion may deny, never establish that a document is an invoice.
export function legacyNegativeDocumentType(read, serverSha256) {
  if (!read || typeof read !== 'object' || Array.isArray(read)
    || 'documentType' in read || 'documentClassification' in read
    || typeof serverSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(serverSha256)
    || read.documentSha256 !== serverSha256
    || typeof read.primaryReadId !== 'string' || !read.primaryReadId.trim()
    || !EXTRACTION_MODELS.includes(read.provenance?.model)) return null;
  const parsed = ExtractedInvoiceSchema.safeParse(read.extraction);
  if (!parsed.success) return null;
  const extraction = parsed.data;
  if (['vendorName', 'amountMinor', 'currency', 'dueDate'].some(field => extraction[field] !== null)
    || !extraction.extractionWarnings.includes(receiptWarning)
    || extraction.extractionWarnings.some(warning => warning !== receiptWarning && warning !== missingTotalWarning
      && missingCurrencyWarning.exec(warning)?.[0] !== warning)) return null;
  return { documentType: 'PAYMENT_RECEIPT', source: 'LEGACY_NEGATIVE_WARNING', version: 'legacy-negative-v1',
    primaryReadId: read.primaryReadId, documentSha256: serverSha256 };
}

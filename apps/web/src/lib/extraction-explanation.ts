import type { ExtractedInvoice, PolicyDecision, TraceStep } from '@/contracts';
import { getLocale, t } from '@/i18n';
import { reasonInfo } from '@/contracts/reasons';

const FIELD_LABELS: Record<string, string> = {
  vendorName: 'Vendor', invoiceNumber: 'Invoice number', amountMinor: 'Amount',
  currency: 'Currency', issuedAt: 'Issue date', dueDate: 'Due date',
  servicePeriod: 'Service period', description: 'Description',
};

const READING_NOTES = [
  { pattern: /^The line item descriptions are generic placeholders\b/, message: 'The items have generic names, such as “Producto 1”. Check that they describe what you agreed to buy.' },
  { pattern: /^The seller is identified only by the explicit counterparty heading .+; no explicit Supplier\/Proveedor\/Emisor field is present\.$/, message: 'Please check who issued the invoice and confirm that the vendor shown here is the one charging you.' },
  { pattern: /^The (?:seller\/issuer|seller|issuer) identity is (?:ambiguous|unclear)\b/i, message: 'The document shows more than one party. Please confirm who is charging you before approving the invoice.' },
];

export function readingNeedsReview(decision: PolicyDecision): boolean {
  const reading = decision.trace?.find(step => step.rule === 'EXTRACTION');
  return reading ? reading.result !== 'PASS' : decision.reasons.includes('INVALID_OR_MISSING_DATA');
}

/** Presentation only: describe uncertainty without changing the recorded result. */
export function extractionExplanation(extracted?: ExtractedInvoice | null, step?: TraceStep): string[] {
  let issues = '';
  try {
    const evidence: unknown = JSON.parse(step?.evidence ?? '{}');
    if (evidence && typeof evidence === 'object' && 'issues' in evidence && typeof evidence.issues === 'string') {
      issues = evidence.issues;
    }
  } catch { /* Unknown evidence stays available in Logs. */ }

  const warnings = extracted?.extractionWarnings ?? [];
  const signals = [issues, ...warnings].join(', ');
  const mismatches = new Set<string>();
  const missing = new Set<string>();
  const unconfirmed = new Set<string>();
  for (const match of signals.matchAll(/(?:INDEPENDENT_READ_MISMATCH|FIELD_MISMATCH|MISSING_CRITICAL_FIELD|INDEPENDENT_READ_UNAVAILABLE|CORROBORATION_FIELD_UNAVAILABLE):([a-zA-Z]+)/g)) {
    const field = match[1]!;
    if (FIELD_LABELS[field]) (match[0].startsWith('MISSING_') ? missing : match[0].includes('UNAVAILABLE:') ? unconfirmed : mismatches).add(field);
  }
  if (extracted) {
    for (const field of ['vendorName', 'amountMinor', 'currency', 'dueDate'] as const) {
      if (extracted[field] == null || extracted[field] === '') missing.add(field);
    }
  }
  const fields = (keys: Set<string>) => new Intl.ListFormat(getLocale(), { style: 'long', type: 'conjunction' })
    .format([...keys].map(key => t(FIELD_LABELS[key]!)));
  const messages: string[] = [];
  if (mismatches.size) messages.push(t('Please check these invoice details: {fields}. I could not confirm them confidently; this does not mean your invoice is wrong.', { fields: fields(mismatches) }));
  if (unconfirmed.size) messages.push(t('I found these details but could not fully check them: {fields}. You can review them against the original document.', { fields: fields(unconfirmed) }));
  if (missing.size) messages.push(t('I could not read these required details: {fields}.', { fields: fields(missing) }));
  if (/CORROBORATION_REQUIRED|SOURCE_MISMATCH|SAME_READ|INVALID_SOURCE/.test(issues)) {
    messages.push(t('I could not finish checking the document. You can review its details yourself or ask me to try again.'));
  }
  for (const note of READING_NOTES) {
    if (warnings.some(w => note.pattern.test(w))) messages.push(t(note.message));
  }
  if (warnings.some(w => !/^INDEPENDENT_READ_(?:MISMATCH|UNAVAILABLE):[a-zA-Z]+$/.test(w)
    && !READING_NOTES.some(note => note.pattern.test(w)))) {
    messages.push(t('There are other details that need your attention. You can see the full notes in Logs.'));
  }
  if (!messages.length) messages.push(t('I could not confirm all the invoice details. They need to be checked before approval.'));
  return messages;
}

export function invoiceExplanation(decision: PolicyDecision): string {
  if (!readingNeedsReview(decision)) return decision.explanation || t('No explanation was recorded.');
  const messages = [t('I left this invoice in review because some details need confirmation. You can check the original and decide whether to approve it.')];
  const otherReasons = decision.reasons.filter(reason => reason !== 'INVALID_OR_MISSING_DATA');
  if (otherReasons.length) messages.push(t('There are also other findings: {findings}.', { findings: otherReasons.map(reason => reasonInfo(reason).label).join('; ') }));
  return messages.join(' ');
}

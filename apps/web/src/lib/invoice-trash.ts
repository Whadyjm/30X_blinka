import type { InvoiceTrashEvent } from '@oli/contracts';

/** The API orders append-only events newest first, including equal timestamps. */
export function invoiceTrashState(events: InvoiceTrashEvent[]) {
  const latest = new Map<string, InvoiceTrashEvent>();
  for (const event of events) if (!latest.has(event.invoiceId)) latest.set(event.invoiceId, event);
  return latest;
}

import { describe, expect, it } from 'vitest';
import type { InvoiceTrashEvent } from '@oli/contracts';
import { invoiceTrashState } from '../../src/lib/invoice-trash';
const event = (id: string, invoiceId: string, trashed: boolean): InvoiceTrashEvent => ({ id, invoiceId, invoiceName: 'Fictitious invoice', trashed, at: '2026-10-17T12:00:00Z', userId: 'owner', userName: 'Owner' });
describe('invoice trash projection', () => {
  it('uses server order for equal timestamps and separates invoices', () => {
    const events = [event('restored', 'a', false), event('deleted-b', 'b', true), event('deleted-a', 'a', true)];
    const before = structuredClone(events);
    expect(invoiceTrashState(events).get('a')?.trashed).toBe(false);
    expect(invoiceTrashState(events).get('b')?.trashed).toBe(true);
    expect(events).toEqual(before);
  });
  it('supports an empty history without hiding active invoices', () => {
    expect(invoiceTrashState([]).get('active')).toBeUndefined();
  });
});

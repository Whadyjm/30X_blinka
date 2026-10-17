import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { ProposalFields } from '../../src/features/chat/ChatReply';

it('shows supplier names and terms without exposing internal identifiers from proposals or before snapshots', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProposalFields, {
    fields: { id: 'agreement_internal', vendorId: 'vendor_internal', expectedDecisionId: 'decision_internal', invoiceId: 'invoice_internal', concept: 'Internet', currency: 'USD', amountMinor: 5000, active: true },
    vendorName: 'Proveedor ficticio',
  })));
  expect(html).toContain('Proveedor ficticio'); expect(html).toContain('Internet'); expect(html).toContain('50.00');
  for (const internal of ['agreement_internal', 'vendor_internal', 'decision_internal', 'invoice_internal', 'vendorId', 'expectedDecisionId']) expect(html).not.toContain(internal);
});

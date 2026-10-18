import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ChatCard } from '@oli/contracts';

const getInvoiceIntake = vi.hoisted(() => vi.fn());
vi.mock('../../src/api', () => ({ api: { getInvoiceIntake }, errorMessage: (error: Error) => error.message }));
// QueryObserver runs browser polling timers; no DOM is needed to exercise its subscriptions.
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
const { QueryClient, QueryObserver, QueryClientProvider } = await import('@tanstack/react-query');
const { invoiceIntakeQuery } = await import('../../src/features/chat/invoice-intake-query');
const { ChatCardView } = await import('../../src/features/chat/ChatReply');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { MemoryRouter } = await import('react-router');

type Receipt = Extract<ChatCard, { type: 'INVOICE' }>;
const detail = JSON.parse(readFileSync(new URL('../../../../docs/evaluations/integration-inv_5b32e8f2-06cc-4789-8fa4-131f57e8ef55.json', import.meta.url), 'utf8')).invoice;
const completed: Receipt = { type: 'INVOICE', invoice: detail, intake: {
  status: 'KNOWN_VENDOR', canOnboard: false, canResume: false, expectedDecisionId: detail.latestDecision.id,
  suggestedVendorName: detail.vendorName, suggestedAgreement: null,
} };
const pending: Receipt = { ...completed, invoice: { ...detail, status: 'PARSING', latestDecision: null, decisions: [] },
  intake: { ...completed.intake, status: 'PROCESSING', expectedDecisionId: null } };
let client: InstanceType<typeof QueryClient>;
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); client?.clear(); vi.useRealTimers(); vi.clearAllMocks(); });
afterAll(() => vi.unstubAllGlobals());

it('keeps a shared live receipt past one minute and updates individual and list cards when processing finishes', async () => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  getInvoiceIntake.mockResolvedValue(pending);
  const options = invoiceIntakeQuery(detail.id);
  const individual = new QueryObserver(client, { ...options, initialData: pending, initialDataUpdatedAt: 0 });
  const listed = new QueryObserver(client, options);
  cleanups.push(individual.subscribe(() => {}), listed.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(62_000);
  expect(getInvoiceIntake.mock.calls.length).toBeGreaterThan(30);
  expect(individual.getCurrentResult().data?.intake.status).toBe('PROCESSING');
  getInvoiceIntake.mockResolvedValue(completed);
  await vi.advanceTimersByTimeAsync(2000);
  expect(individual.getCurrentResult().data?.invoice.status).toBe('DECIDED');
  expect(listed.getCurrentResult().data).toEqual(completed);
  const calls = getInvoiceIntake.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(getInvoiceIntake).toHaveBeenCalledTimes(calls);

  for (const card of [pending, { type: 'INVOICES', invoices: [pending.invoice], truncated: false }] satisfies ChatCard[]) {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, null, createElement(ChatCardView, { card }))));
    expect(html).toContain('Approved');
    expect(html).not.toContain('Reading the document');
  }
});

it('refreshes a previously completed receipt when reopening it and recovers a pending receipt after a network error', async () => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  getInvoiceIntake.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(completed);
  const observer = new QueryObserver(client, { ...invoiceIntakeQuery(detail.id), initialData: completed });
  cleanups.push(observer.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  expect(observer.getCurrentResult().data?.intake.status).toBe('PROCESSING');
  await vi.advanceTimersByTimeAsync(2000);
  expect(observer.getCurrentResult().isError).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(observer.getCurrentResult().data?.invoice.status).toBe('DECIDED');
  expect(observer.getCurrentResult().isError).toBe(false);
});

import { afterEach, describe, expect, it } from 'vitest';
import { InvoiceSummarySchema, PolicyDecisionSchema, type InvoiceSummary } from '../../src/contracts';
import { applyLang } from '../../src/i18n';
import { buildBriefing, computeStats } from '../../src/lib/briefing';

const today = new Date(2026, 9, 17, 12);
const invoice = (id: string, data: Partial<InvoiceSummary> = {}) => InvoiceSummarySchema.parse({
  id, status: 'PROCESSING', source: 'HUMAN_UPLOAD', receivedAt: '2026-10-17T10:00:00Z', ...data,
});
const escalated = (id: string, canDecide: boolean, data: Partial<InvoiceSummary> = {}) => invoice(id, {
  status: 'NEEDS_APPROVAL',
  decision: PolicyDecisionSchema.parse({ decision: 'ESCALATE', reasons: [], explanation: 'Server reason' }),
  approval: { id: `approval-${id}`, state: 'PENDING', canDecide },
  ...data,
});
afterEach(() => applyLang('en'));

describe('dashboard attention', () => {
  it('includes approvals, corrections and failures, excluding completed decisions and processing', () => {
    const stats = computeStats([
      escalated('approval', true), escalated('review', false), invoice('failure', { status: 'FAILED' }),
      invoice('approved', { status: 'APPROVED' }), invoice('blocked', { status: 'BLOCKED' }),
      invoice('rejected', { status: 'REJECTED' }), invoice('working'),
    ], today);
    expect(stats.attention.map(i => i.id)).toEqual(['approval', 'review', 'failure']);
    expect(stats.needsYouCount).toBe(3);
    expect(stats.approvedCount).toBe(1);
    expect(stats.blockedCount).toBe(1);
    expect(stats.processingCount).toBe(1);
  });

  it('puts overdue cases first and undated cases last, with oldest arrivals first on ties', () => {
    const invoices = [
      escalated('no-date', false), escalated('tomorrow', true, { dueDate: '2026-10-18' }),
      escalated('today-new', true, { dueDate: '2026-10-17' }),
      escalated('today-old', false, { dueDate: '2026-10-17', receivedAt: '2026-10-16T10:00:00Z' }),
      invoice('overdue', { status: 'FAILED', dueDate: '2026-10-15' }),
    ];
    const before = structuredClone(invoices);
    expect(computeStats(invoices, today).attention.map(i => i.id)).toEqual(['overdue', 'today-old', 'today-new', 'tomorrow', 'no-date']);
    expect(invoices).toEqual(before);
  });

  it('limits urgency and upcoming dates to unresolved attention cases', () => {
    const stats = computeStats([
      invoice('approved-overdue', { status: 'APPROVED', dueDate: '2026-10-01' }),
      invoice('blocked-overdue', { status: 'BLOCKED', dueDate: '2026-10-01' }),
      escalated('overdue', false, { dueDate: '2026-10-16' }),
      escalated('today', true, { dueDate: '2026-10-17' }),
      escalated('day-14', false, { dueDate: '2026-10-31' }),
      escalated('later', true, { dueDate: '2026-11-01' }),
    ], today);
    expect(stats.overdue.map(i => i.id)).toEqual(['overdue']);
    expect(stats.upcoming.map(i => i.id)).toEqual(['today', 'day-14']);
  });

  it.each([escalated('review-only', false), invoice('failure-only', { status: 'FAILED' })])('does not report no intervention when $id requires attention', inv => {
    applyLang('en');
    const briefing = buildBriefing(computeStats([inv], today), today);
    expect(briefing[0]).toBe('1 invoice needs your attention.');
    expect(briefing.join(' ')).not.toMatch(/on track|Nothing is waiting|No pending/);
  });

  it('reports processing separately instead of implying all work has finished', () => {
    applyLang('en');
    expect(buildBriefing(computeStats([invoice('working')], today), today)).toEqual([
      'No pending interventions.', '1 invoice is still processing.',
    ]);
  });

  it('keeps approved totals separate by currency and translates the attention summary', () => {
    const stats = computeStats([
      escalated('review', false),
      invoice('usd', { status: 'APPROVED', amountMinor: 10000, currency: 'USD' }),
      invoice('eur', { status: 'APPROVED', amountMinor: 500000, currency: 'EUR' }),
    ], today);
    expect(stats.approvedMinor).toEqual({ USD: 10000, EUR: 500000 });
    applyLang('en');
    expect(buildBriefing(stats, today)[1]).toContain('$100.00 USD + €5,000.00 EUR');
    applyLang('es');
    expect(buildBriefing(stats, today)[0]).toBe('1 factura necesita tu atención.');
  });
});

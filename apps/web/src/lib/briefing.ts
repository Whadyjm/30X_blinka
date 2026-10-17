import type { InvoiceSummary } from '@/contracts';
import { t } from '@/i18n';
import { daysUntil } from './dates';
import { formatMoney } from './money';
import { getOutcome } from './outcome';

export type Stats = {
  approvedCount: number;
  approvedMinor: Record<string, number>;
  blockedCount: number;
  needsYouCount: number;
  upcoming: InvoiceSummary[];
  overdue: InvoiceSummary[];
};

/** Counts derived from the server's invoice list. The "briefing" below reads these — never invented text. */
export function computeStats(invoices: InvoiceSummary[], today: Date = new Date()): Stats {
  const stats: Stats = { approvedCount: 0, approvedMinor: {}, blockedCount: 0, needsYouCount: 0, upcoming: [], overdue: [] };
  for (const inv of invoices) {
    const o = getOutcome(inv);
    if (o === 'APPROVED') {
      stats.approvedCount++;
      if (inv.amountMinor != null && inv.currency) {
        stats.approvedMinor[inv.currency] = (stats.approvedMinor[inv.currency] ?? 0) + inv.amountMinor;
      }
    } else if (o === 'BLOCKED') stats.blockedCount++;
    else if (o === 'NEEDS_APPROVAL') stats.needsYouCount++;

    // Due-date calendar: only invoices that are not terminally rejected/blocked.
    if (o === 'APPROVED' || o === 'NEEDS_APPROVAL') {
      const n = daysUntil(inv.dueDate, today);
      if (n != null) (n < 0 ? stats.overdue : n <= 14 ? stats.upcoming : []).push(inv);
    }
  }
  stats.upcoming.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return stats;
}

export function buildBriefing(stats: Stats, today: Date = new Date()): string[] {
  const lines: string[] = [];
  if (stats.needsYouCount > 0) {
    lines.push(
      stats.needsYouCount === 1
        ? t('1 invoice needs your decision — everything else is on track.')
        : t('{n} invoices need your decision — everything else is on track.', { n: stats.needsYouCount }),
    );
  } else {
    lines.push(t('Nothing is waiting on you right now.'));
  }
  if (stats.approvedCount > 0) {
    const totals = Object.entries(stats.approvedMinor)
      .map(([cur, minor]) => formatMoney(minor, cur))
      .join(' + ');
    lines.push(
      totals
        ? t('{n} approved for simulated payment ({total}).', { n: stats.approvedCount, total: totals })
        : t('{n} approved for simulated payment.', { n: stats.approvedCount }),
    );
  }
  if (stats.blockedCount > 0) {
    lines.push(
      stats.blockedCount === 1
        ? t('1 invoice was blocked by your rules.')
        : t('{n} invoices were blocked by your rules.', { n: stats.blockedCount }),
    );
  }
  const next = stats.upcoming[0];
  if (next) {
    const n = daysUntil(next.dueDate, today);
    const vendor = next.vendorName ?? t('an invoice');
    lines.push(
      n === 0
        ? t('Next due: {vendor} today.', { vendor })
        : n === 1
          ? t('Next due: {vendor} tomorrow.', { vendor })
          : t('Next due: {vendor} in {n} days.', { vendor, n: n ?? 0 }),
    );
  }
  if (stats.overdue.length > 0) {
    lines.push(t('{n} past due — worth a look.', { n: stats.overdue.length }));
  }
  return lines;
}

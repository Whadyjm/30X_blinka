import type { InvoiceSummary } from '@/contracts';
import { t } from '@/i18n';
import { daysUntil } from './dates';
import { formatMoneyWithCode } from './money';
import { getOutcome } from './outcome';

export type Stats = {
  approvedCount: number;
  approvedMinor: Record<string, number>;
  blockedCount: number;
  needsApprovalCount: number;
  needsReviewCount: number;
  failedCount: number;
  needsYouCount: number;
  attention: InvoiceSummary[];
  processingCount: number;
  upcoming: InvoiceSummary[];
  overdue: InvoiceSummary[];
};

/** Counts derived from the server's invoice list. The "briefing" below reads these — never invented text. */
export function computeStats(invoices: InvoiceSummary[], today: Date = new Date()): Stats {
  const stats: Stats = { approvedCount: 0, approvedMinor: {}, blockedCount: 0, needsApprovalCount: 0, needsReviewCount: 0, failedCount: 0, needsYouCount: 0, attention: [], processingCount: 0, upcoming: [], overdue: [] };
  for (const inv of invoices) {
    const o = getOutcome(inv);
    if (o === 'APPROVED') {
      stats.approvedCount++;
      if (inv.amountMinor != null && inv.currency) {
        stats.approvedMinor[inv.currency] = (stats.approvedMinor[inv.currency] ?? 0) + inv.amountMinor;
      }
    } else if (o === 'BLOCKED') stats.blockedCount++;
    else if (o === 'PROCESSING') stats.processingCount++;

    if (o === 'NEEDS_APPROVAL') stats.needsApprovalCount++;
    if (o === 'NEEDS_REVIEW') stats.needsReviewCount++;
    if (o === 'FAILED') stats.failedCount++;
    // A block needs its reason reviewed, never permission to bypass the rules.
    if (o === 'BLOCKED') stats.attention.push(inv);
    if (o === 'NEEDS_APPROVAL' || o === 'NEEDS_REVIEW' || o === 'FAILED') {
      stats.attention.push(inv);
      const n = daysUntil(inv.dueDate, today);
      if (n != null) (n < 0 ? stats.overdue : n <= 14 ? stats.upcoming : []).push(inv);
    }
  }
  stats.needsYouCount = stats.attention.length;
  stats.attention.sort((a, b) => {
    const dueA = daysUntil(a.dueDate, today) ?? Infinity;
    const dueB = daysUntil(b.dueDate, today) ?? Infinity;
    return dueA === dueB ? a.receivedAt.localeCompare(b.receivedAt) : dueA - dueB;
  });
  stats.overdue.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  stats.upcoming.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return stats;
}

export function buildBriefing(stats: Stats, today: Date = new Date()): string[] {
  const lines: string[] = [];
  if (stats.needsYouCount > 0) {
    lines.push(
      stats.needsYouCount === 1
        ? t('1 invoice needs your attention.')
        : t('{n} invoices need your attention.', { n: stats.needsYouCount }),
    );
  } else {
    lines.push(t('No pending interventions.'));
  }
  if (stats.processingCount > 0) {
    lines.push(stats.processingCount === 1
      ? t('1 invoice is still processing.')
      : t('{n} invoices are still processing.', { n: stats.processingCount }));
  }
  if (stats.approvedCount > 0) {
    const totals = Object.entries(stats.approvedMinor)
      .map(([cur, minor]) => formatMoneyWithCode(minor, cur))
      .join(' + ');
    lines.push(
      totals
        ? t('{n} invoices approved ({total}).', { n: stats.approvedCount, total: totals })
        : t('{n} invoices approved.', { n: stats.approvedCount }),
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

import { getLocale, t } from '@/i18n';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Parse "YYYY-MM-DD" with no timezone shifting. */
export function parseDateOnly(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "2026-10-18" → "Oct 18, 2026" / "18 oct 2026". */
export function formatDate(s: string | null | undefined): string {
  const p = parseDateOnly(s);
  if (!p) return '—';
  if (getLocale().startsWith('es')) return `${p.d} ${MONTHS_ES[p.m - 1] ?? '???'} ${p.y}`;
  return `${MONTHS_EN[p.m - 1] ?? '???'} ${p.d}, ${p.y}`;
}

/** Accepts ISO or SQLite "YYYY-MM-DD HH:MM:SS" (treated as UTC). */
export function parseTimestamp(s: string | null | undefined): Date | null {
  if (!s) return null;
  let v = s.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) v = v.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) v += 'Z';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(s: string | null | undefined): string {
  const d = parseTimestamp(s);
  if (!d) return '—';
  return d.toLocaleString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseTimestamp(s);
  if (!d) return '—';
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 45) return t('just now');
  if (sec < 90) return t('1 min ago');
  const min = Math.round(sec / 60);
  if (min < 60) return t('{n} min ago', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('{n} h ago', { n: hr });
  const day = Math.round(hr / 24);
  if (day < 7) return t('{n} d ago', { n: day });
  return formatDateTime(s);
}

/** Whole days from `today` (local calendar date) to a YYYY-MM-DD due date. Negative = overdue. */
export function daysUntil(due: string | null | undefined, today: Date = new Date()): number | null {
  const p = parseDateOnly(due);
  if (!p) return null;
  const a = Date.UTC(p.y, p.m - 1, p.d);
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function dueLabel(due: string | null | undefined, today: Date = new Date()): string {
  const n = daysUntil(due, today);
  if (n == null) return t('No due date');
  if (n < 0) return t('{n} d overdue', { n: -n });
  if (n === 0) return t('Due today');
  if (n === 1) return t('Due tomorrow');
  return t('Due in {n} d', { n });
}

/** True when `dueLabel` describes an overdue invoice (language-independent). */
export function isOverdue(due: string | null | undefined, today: Date = new Date()): boolean {
  const n = daysUntil(due, today);
  return n != null && n < 0;
}

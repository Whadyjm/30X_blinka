/**
 * Money helpers. All amounts are integer minor units. No float arithmetic on money.
 */

/** Number of minor-unit digits for a currency (USD=2, JPY=0, KWD=3). Falls back to 2. */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function isValidCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency });
    return /^[A-Z]{3}$/.test(currency);
  } catch {
    return false;
  }
}

/** 85000 + "USD" → "$850.00". Uses BigInt to avoid float drift on large values. */
export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return '—';
  const cur = currency && isValidCurrency(currency) ? currency : null;
  const exp = cur ? currencyExponent(cur) : 2;
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(exp);
  const whole = abs / base;
  const frac = abs % base;
  const wholeStr = new Intl.NumberFormat('en-US').format(whole);
  const fracStr = exp > 0 ? `.${frac.toString().padStart(exp, '0')}` : '';
  const sign = neg ? '-' : '';
  if (!cur) return `${sign}${wholeStr}${fracStr}${currency ? ` ${currency}` : ''}`;
  const symbol =
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? cur;
  const body = `${wholeStr}${fracStr}`;
  if (symbol === cur) return `${sign}${cur}\u00a0${body}`; // no symbol available → "CHF 1,000.00"
  // "$" is shared by many currencies: disambiguate everything except USD.
  if (symbol === '$' && cur !== 'USD') return `${sign}$${body} ${cur}`;
  return `${sign}${symbol}${body}`;
}

/** Same as formatMoney but always appends the ISO code: "$850.00 USD". Useful where currency matters. */
export function formatMoneyWithCode(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return '—';
  const base = formatMoney(minor, currency);
  return currency && !base.includes(currency) ? `${base} ${currency}` : base;
}

/**
 * Parse user input ("1,250.5") into minor units WITHOUT floats.
 * Returns null when the text is not a valid amount for the currency.
 */
export function toMinor(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, '').replace(/^[$€£]/, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const fracRaw = m[2] ?? '';
  if (fracRaw.length > exp) return null; // never silently round money
  const frac = fracRaw.padEnd(exp, '0');
  const big = BigInt(whole + frac);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(big);
}

/** Inverse of toMinor for editing: 85000,"USD" → "850.00". */
export function fromMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(exp);
  const whole = (abs / base).toString();
  const frac = exp > 0 ? `.${(abs % base).toString().padStart(exp, '0')}` : '';
  return `${minor < 0 ? '-' : ''}${whole}${frac}`;
}

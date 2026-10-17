/**
 * Tolerant shape adapters. They only restructure envelopes the brief leaves open
 * (e.g. `{invoice, decision, audit}` vs a flat invoice). They never change values.
 */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** `{ invoice: {...}, decision?, audit?, extracted?, approval? }` → flat invoice detail. */
export function flattenInvoice(raw: unknown): unknown {
  if (!isRec(raw)) return raw;
  const inner = raw.invoice;
  if (!isRec(inner)) return raw;
  const { invoice: _drop, ...rest } = raw;
  void _drop;
  return { ...inner, ...rest };
}

/** snake_case keys → camelCase, recursively. Lets a D1-row-shaped response through without friction. */
export function camelize<T = unknown>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camelize(x)) as T;
  if (isRec(v)) {
    const out: Rec = {};
    for (const [k, val] of Object.entries(v)) {
      // Keep user-defined bags (facts / details) untouched except for key style.
      out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camelize(val);
    }
    return out as T;
  }
  return v as T;
}

import { ChatCardSchema, ChatToolInputSchemas as schemas, ChatToolParameters } from '@oli/contracts';
import { HttpError, periodKey, stmt } from './http.js';
import { agreementDto, invoiceRows, vendorDto } from './repository.js';
import { budgets } from './configuration.js';
import { inspectInvoice, prepareAction } from './chat-actions.js';

const descriptions = {
  list_invoices: 'Read up to 20 company invoices. Never interpret APPROVE as a bank transfer.',
  inspect_invoice: 'Read one invoice, its recorded decisions and trusted intake status. UNKNOWN_VENDOR may offer owner-confirmed onboarding; uncertain extraction and disallowed vendors cannot.',
  list_vendors: 'Read company vendors and their allowed flag.',
  list_agreements: 'Read company agreements, optionally for one vendor.',
  get_budget: 'Read recorded budget and reservations for a company month.',
  summarize_invoices: 'Compute invoice totals by currency for a month. Optional query is a literal substring of vendor/description, not a verified spending category. Period uses servicePeriod, falling back to issue date. Totals are invoiced/approved/blocked, never money actually paid.',
  prepare_change: 'Prepare a proposed directory change for a human review card. DOES NOT execute it. Use only after the user supplies required data. ONBOARD_INVOICE_VENDOR requires the inspected expectedDecisionId, exact vendor name, explicit allowed flag and confirmed commercial terms; never invent an agreement from a bill. RESUME_INVOICE resolves a previously unknown vendor now registered with the exact name. Only the user UI can confirm actions.',
};
export function toolsFor(session) {
  return Object.entries(schemas).filter(([name]) => name !== 'prepare_change' || session.role === 'OWNER')
    .map(([name]) => ({ type: 'function', function: { name, description: descriptions[name], parameters: ChatToolParameters[name] } }));
}
export function resolvePeriod(value, timezone) {
  const current = periodKey(timezone);
  if (value === 'CURRENT_MONTH') return current;
  if (value !== 'PREVIOUS_MONTH') return value;
  const [year, month] = current.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
export async function runTool(env, session, name, raw) {
  if (!Object.hasOwn(schemas, name)) throw new HttpError(502, 'CHAT_INVALID_TOOL');
  const parsed = schemas[name].safeParse(raw);
  if (!parsed.success) throw new HttpError(502, 'CHAT_INVALID_TOOL_ARGUMENTS');
  const input = parsed.data, org = session.organization.id;
  if (name === 'prepare_change') return { prepared: await prepareAction(env, session, input.proposal) };
  let card;
  if (name === 'inspect_invoice') card = await inspectInvoice(env, session, input.invoiceId);
  if (name === 'list_invoices') {
    const all = (await invoiceRows(env.DB, org)).filter(i => !input.action || i.latestDecision?.action === input.action);
    card = { type: 'INVOICES', invoices: all.slice(0, 20), truncated: all.length > 20 };
  }
  if (name === 'list_vendors' || name === 'list_agreements') {
    const table = name === 'list_vendors' ? 'vendors' : 'agreements';
    const where = input.vendorId ? ' AND vendor_id = ?' : '';
    const rows = (await stmt(env.DB, `SELECT * FROM ${table} WHERE org_id = ?${where} ORDER BY created_at DESC, id DESC LIMIT 21`,
      ...[org, ...(input.vendorId ? [input.vendorId] : [])]).all()).results;
    card = name === 'list_vendors' ? { type: 'VENDORS', vendors: rows.slice(0, 20).map(vendorDto), truncated: rows.length > 20 }
      : { type: 'AGREEMENTS', agreements: rows.slice(0, 20).map(agreementDto), truncated: rows.length > 20 };
  }
  if (name === 'get_budget' || name === 'summarize_invoices') {
    const key = resolvePeriod(input.period, session.organization.timezone);
    if (name === 'get_budget') card = { type: 'BUDGET', periodKey: key, budgets: await budgets(env.DB, org, key) };
    else {
      const totals = (await stmt(env.DB, `SELECT i.currency, count(*) AS n, sum(i.amount_minor) AS invoiced,
        sum(CASE WHEN d.action = 'APPROVE' THEN i.amount_minor ELSE 0 END) AS approved,
        sum(CASE WHEN d.action = 'BLOCK' THEN i.amount_minor ELSE 0 END) AS blocked
        FROM invoices i LEFT JOIN decisions d ON d.id = (SELECT id FROM decisions WHERE org_id = i.org_id AND invoice_id = i.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
        WHERE i.org_id = ? AND coalesce(i.service_period, substr(i.issued_at,1,7)) = ?
          AND i.amount_minor IS NOT NULL AND i.currency IS NOT NULL
          AND (? IS NULL OR instr(lower(coalesce(i.vendor_name,'') || ' ' || coalesce(i.description,'')), lower(?)) > 0)
        GROUP BY i.currency ORDER BY i.currency`, org, key, input.query, input.query).all()).results;
      card = { type: 'SPEND', periodKey: key, query: input.query, periodBasis: 'SERVICE_PERIOD_OR_ISSUE_DATE', amountBasis: 'EXTRACTED_AMOUNTS_NOT_PAYMENTS',
        totals: totals.map(r => ({ currency: r.currency, count: r.n, invoicedMinor: r.invoiced, approvedMinor: r.approved, blockedMinor: r.blocked })) };
    }
  }
  return { card: ChatCardSchema.parse(card) };
}

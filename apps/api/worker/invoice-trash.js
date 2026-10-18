import { SetInvoiceTrashSchema, InvoiceTrashEventSchema } from '@oli/contracts';
import { owner } from './auth.js';
import { body, clearGuard, HttpError, id, json, now, sha256, stmt } from './http.js';
import { idempotency } from './repository.js';

const eventTypes = "'INVOICE_TRASHED','INVOICE_RESTORED'";
export async function invoiceTrashEvents(db, orgId) {
  const rows = (await stmt(db, `SELECT a.*, u.name AS user_name FROM audit_events a
    LEFT JOIN users u ON u.id = a.actor_id WHERE a.org_id = ? AND a.type IN (${eventTypes})
    ORDER BY a.rowid DESC`, orgId).all()).results;
  return rows.map(row => InvoiceTrashEventSchema.parse({ id: row.id, invoiceId: row.entity_id,
    invoiceName: JSON.parse(row.details_json).invoiceName ?? row.entity_id, trashed: row.type === 'INVOICE_TRASHED', at: row.created_at, userId: row.actor_id, userName: row.user_name ?? null }));
}

export async function setInvoiceTrash(request, env, session, invoiceId) {
  owner(session);
  const input = await body(request, SetInvoiceTrashSchema);
  const orgId = session.organization.id;
  const requestHash = await sha256(JSON.stringify({ invoiceId, ...input }));
  const idem = await idempotency(request, env.DB, session, requestHash);
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const invoice = await stmt(env.DB, 'SELECT id, vendor_name, file_name FROM invoices WHERE org_id = ? AND id = ?', orgId, invoiceId).first();
  if (!invoice) throw new HttpError(404, 'NOT_FOUND');
  const event = { id: id('evt'), invoiceId, invoiceName: invoice.vendor_name ?? invoice.file_name, trashed: input.trashed, at: now(), userId: session.user.id, userName: session.user.name ?? null };
  const response = { data: InvoiceTrashEventSchema.parse(event) };
  const guardId = id('guard');
  try {
    await env.DB.batch([
      stmt(env.DB, `INSERT INTO commit_guards(id,valid) VALUES (?, coalesce((SELECT id FROM audit_events
        WHERE org_id = ? AND entity_id = ? AND type IN (${eventTypes}) ORDER BY rowid DESC LIMIT 1),'') = coalesce(?,'')
        AND EXISTS(SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ? AND role = 'OWNER'))`,
      guardId, orgId, invoiceId, input.expectedEventId, orgId, session.user.id),
      stmt(env.DB, `INSERT INTO audit_events(id,org_id,actor_kind,actor_id,type,entity_id,details_json,created_at)
        VALUES (?,?,'HUMAN',?,?,?,?,?)`, event.id, orgId, session.user.id, input.trashed ? 'INVOICE_TRASHED' : 'INVOICE_RESTORED',
      invoiceId, JSON.stringify({ invoiceName: event.invoiceName, previousEventId: input.expectedEventId, documentAndDecisionsRetained: true }), event.at),
      idem.save(response), clearGuard(env.DB, guardId),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, requestHash);
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/CHECK constraint failed: valid/.test(String(error))) throw new HttpError(409, 'TRASH_CHANGED', 'La papelera cambió. Actualiza e intenta de nuevo.');
    throw error;
  }
  return json(response);
}

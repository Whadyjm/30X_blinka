export class HttpError extends Error {
  constructor(status, code, message = code, fieldErrors = {}) {
    super(message); Object.assign(this, { status, code, fieldErrors });
  }
}
export const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
export const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export const normalizeName = (value) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function equalSecret(provided, expected) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(expected), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(provided));
}
export async function readBytes(request, maxBytes) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new HttpError(413, 'FILE_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'FILE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function body(request, schema) {
  let raw;
  try { raw = JSON.parse(new TextDecoder().decode(await readBytes(request, 64 * 1024))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'VALIDATION_ERROR'); }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) (fields[issue.path.join('.') || 'body'] ??= []).push(issue.message);
    throw new HttpError(400, 'VALIDATION_ERROR', 'Revisa los campos indicados.', fields);
  }
  return result.data;
}
export function periodKey(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
export function originCheck(request, env = {}) {
  const url = new URL(request.url); const origin = request.headers.get('Origin');
  if (origin === url.origin) return;
  // Explicit local Vite proxy origin; this exception cannot activate on a deployed host.
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && origin === env.DEV_WEB_ORIGIN) {
    try { const dev = new URL(origin); if (dev.protocol === 'http:' && dev.hostname === url.hostname) return; } catch {}
  }
  throw new HttpError(403, 'CSRF_INVALID');
}
export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
export function guard(db, orgId, revision, guardId) {
  return stmt(db, 'INSERT INTO commit_guards(id, valid) VALUES (?, coalesce((SELECT state_revision = ? FROM organizations WHERE id = ?), 0))', guardId, revision, orgId);
}
export const clearGuard = (db, guardId) => stmt(db, 'DELETE FROM commit_guards WHERE id = ?', guardId);
export function audit(db, orgId, actorId, type, entityId, details, time = now()) {
  return stmt(db, `INSERT INTO audit_events (id, org_id, actor_kind, actor_id, type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id('evt'), orgId, actorId ? 'HUMAN' : 'SYSTEM', actorId, type, entityId, JSON.stringify(details), time);
}

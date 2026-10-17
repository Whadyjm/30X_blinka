import { CreateSkillConnectionSchema, SkillConnectionSchema, UpdateSkillConnectionSchema } from '@oli/contracts';
import { owner } from './auth.js';
import { audit, body, HttpError, id, json, now, readBytes, sha256, stmt } from './http.js';
import { uploadInvoice } from './invoices.js';
import { getInvoice } from './repository.js';
import { enqueueInvoice } from './jobs.js';
import { processInvoice } from './processing.js';

const scopes = ['invoices:submit', 'invoices:read-own', 'invoices:process-own'];
const dto = row => SkillConnectionSchema.parse({ id: row.id, name: row.name, keyPrefix: row.key_prefix, scopes,
  createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at });

export async function skillConnections(env, session) {
  owner(session);
  const rows = (await stmt(env.DB, 'SELECT * FROM agent_connections WHERE org_id = ? ORDER BY created_at DESC, id DESC', session.organization.id).all()).results;
  return json({ data: { connections: rows.map(dto) } });
}

export async function createSkillConnection(request, env, session) {
  owner(session);
  const { name } = await body(request, CreateSkillConnectionSchema);
  const token = `oli_sk_${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}`;
  const row = { id: id('agent'), name, key_prefix: token.slice(0, 15), created_at: now(),
    expires_at: null, last_used_at: null, revoked_at: null };
  await env.DB.batch([
    stmt(env.DB, `INSERT INTO agent_connections(id,org_id,user_id,name,token_hash,key_prefix,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`, row.id, session.organization.id, session.user.id, name, await sha256(token), row.key_prefix, row.created_at, row.expires_at),
    audit(env.DB, session.organization.id, session.user.id, 'AGENT_CONNECTED', row.id, { name, scopes, expiresAt: row.expires_at }),
  ]);
  return json({ data: { connection: dto(row), apiKey: token } }, 201);
}

export async function revokeSkillConnection(env, session, connectionId) {
  owner(session);
  const row = await stmt(env.DB, 'SELECT * FROM agent_connections WHERE org_id = ? AND id = ?', session.organization.id, connectionId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  if (!row.revoked_at) await env.DB.batch([
    stmt(env.DB, 'UPDATE agent_connections SET revoked_at = ? WHERE org_id = ? AND id = ? AND revoked_at IS NULL', now(), session.organization.id, connectionId),
    audit(env.DB, session.organization.id, session.user.id, 'AGENT_REVOKED', connectionId, {}),
  ]);
  return new Response(null, { status: 204 });
}

export async function updateSkillConnection(request, env, session, connectionId) {
  owner(session);
  const { expiresAt } = await body(request, UpdateSkillConnectionSchema);
  const row = await stmt(env.DB, 'SELECT * FROM agent_connections WHERE org_id = ? AND id = ?', session.organization.id, connectionId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  if (row.revoked_at) throw new HttpError(409, 'AGENT_REVOKED');
  await env.DB.batch([
    stmt(env.DB, 'UPDATE agent_connections SET expires_at = ? WHERE org_id = ? AND id = ?', expiresAt, session.organization.id, connectionId),
    audit(env.DB, session.organization.id, session.user.id, 'AGENT_EXPIRY_UPDATED', connectionId, { expiresAt }),
  ]);
  return json({ data: dto({ ...row, expires_at: expiresAt }) });
}

async function authenticateAgent(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (oli_sk_[0-9a-f]{64})$/)?.[1];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED');
  // Membership is checked on every request; removing/demoting the owner disables their connections.
  const row = await stmt(env.DB, `SELECT a.*, o.name AS org_name, o.timezone FROM agent_connections a
    JOIN memberships m ON m.org_id = a.org_id AND m.user_id = a.user_id
    JOIN organizations o ON o.id = a.org_id
    WHERE a.token_hash = ? AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > ?) AND m.role = 'OWNER'`, await sha256(token), now()).first();
  if (!row) throw new HttpError(401, 'UNAUTHENTICATED');
  const window = Math.floor(Date.now() / 60000);
  const count = await stmt(env.DB, `INSERT INTO agent_request_limits(connection_id,window_start,requests) VALUES (?,?,1)
    ON CONFLICT(connection_id) DO UPDATE SET
      requests = CASE WHEN window_start = excluded.window_start THEN requests + 1 ELSE 1 END,
      window_start = excluded.window_start RETURNING requests`, row.id, window).first('requests');
  if (count > 60) { const error = new HttpError(429, 'RATE_LIMITED'); error.retryAfter = 60; throw error; }
  await stmt(env.DB, 'UPDATE agent_connections SET last_used_at = ? WHERE id = ?', now(), row.id).run();
  return { user: { id: row.user_id }, organization: { id: row.org_id, name: row.org_name, timezone: row.timezone }, agent: { id: row.id, connection: dto(row) } };
}

// This allowlist is deliberately separate from human sessions: a key never becomes an OWNER session.
export async function handleAgentRequest(request, env, path) {
  const session = await authenticateAgent(request, env);
  const org = session.organization.id, agent = session.agent.id;
  if (path === '/agent/me' && request.method === 'GET') {
    await audit(env.DB, org, null, 'AGENT_CONNECTION_CHECKED', agent, { connectionId: agent }).run();
    return json({ data: { connection: session.agent.connection, organization: { id: org, name: session.organization.name }, simulated: true } });
  }
  if (path === '/agent/invoices' && request.method === 'POST') return uploadInvoice(request, env, session);
  const match = path.match(/^\/agent\/invoices\/([^/]+)(?:\/(process))?$/);
  if (!match || !(request.method === 'GET' && !match[2] || request.method === 'POST' && match[2] === 'process')) {
    throw new HttpError(403, 'AGENT_SCOPE_DENIED', 'Esta conexión solo puede enviar, evaluar y consultar sus propias facturas.');
  }
  const invoiceId = match[1];
  const own = await stmt(env.DB, 'SELECT 1 FROM agent_invoice_sources WHERE org_id = ? AND connection_id = ? AND invoice_id = ?', org, agent, invoiceId).first();
  if (!own) throw new HttpError(404, 'NOT_FOUND');
  if (request.method === 'POST') {
    if ((await readBytes(request, 1024)).length) throw new HttpError(400, 'VALIDATION_ERROR', 'La evaluación no recibe datos de extracción ni decisiones.');
    await audit(env.DB, org, null, 'AGENT_PROCESS_REQUESTED', invoiceId, { connectionId: agent }).run();
    const result = await (env.INVOICE_QUEUE ? enqueueInvoice : processInvoice)(env, org, invoiceId);
    if (result.data.approvalRequest) result.data.approvalRequest.canApprove = false;
    return json({ data: result.data }, result.status);
  }
  const invoice = await getInvoice(env.DB, org, invoiceId);
  if (invoice.approvalRequest) invoice.approvalRequest.canApprove = false;
  await audit(env.DB, org, null, 'AGENT_INVOICE_READ', invoiceId, { connectionId: agent }).run();
  return json({ data: invoice });
}

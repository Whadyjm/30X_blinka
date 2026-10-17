import { LoginInputSchema, SessionSchema } from '@oli/contracts';
import { body, equalSecret, HttpError, id, json, now, originCheck, sha256, stmt } from './http.js';

const COOKIE = 'oli_session';
const cookie = (request, token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

export async function authenticate(request, env) {
  const token = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || token.length > 128) throw new HttpError(401, 'UNAUTHENTICATED');
  const tokenHash = await sha256(token);
  const row = await stmt(env.DB, `SELECT s.*, u.name AS user_name, u.email, m.role,
    o.name AS org_name, o.default_currency, o.timezone FROM sessions s
    JOIN users u ON u.id = s.user_id JOIN memberships m ON m.org_id = s.org_id AND m.user_id = s.user_id
    JOIN organizations o ON o.id = s.org_id WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, now()).first();
  if (!row) throw new HttpError(401, 'UNAUTHENTICATED');
  const session = SessionSchema.parse({
    user: { id: row.user_id, name: row.user_name, email: row.email },
    organization: { id: row.org_id, name: row.org_name, defaultCurrency: row.default_currency, timezone: row.timezone },
    role: row.role, csrfToken: row.csrf_token,
  });
  if (!['GET', 'HEAD'].includes(request.method)) {
    originCheck(request, env);
    if (!await equalSecret(request.headers.get('X-CSRF-Token') ?? '', session.csrfToken)) throw new HttpError(403, 'CSRF_INVALID');
  }
  return { ...session, tokenHash };
}

export async function login(request, env) {
  originCheck(request, env);
  // Fail closed until explicitly provisioned; seed users have no passwords.
  if (!env.DEMO_PASSWORD || !env.DEMO_USER_ID || !env.DEMO_ORG_ID) throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Acceso demo no configurado.');
  const input = await body(request, LoginInputSchema);
  const key = await sha256(request.headers.get('CF-Connecting-IP') ?? 'local');
  const seconds = Math.floor(Date.now() / 1000);
  const attempt = await stmt(env.DB, `INSERT INTO login_attempts(key, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN window_start < ? - 900 THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < ? - 900 THEN ? ELSE window_start END
    RETURNING attempts`, key, seconds, seconds, seconds, seconds).first();
  if (attempt.attempts > 10) throw new HttpError(429, 'RATE_LIMITED', 'Espera 15 minutos antes de volver a intentar.');
  const passwordMatches = await equalSecret(input.password, env.DEMO_PASSWORD);
  const user = await stmt(env.DB, `SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE u.id = ? AND m.org_id = ? AND lower(u.email) = ?`, env.DEMO_USER_ID, env.DEMO_ORG_ID, input.email.toLowerCase()).first();
  if (!passwordMatches || !user) throw new HttpError(401, 'INVALID_CREDENTIALS');
  const token = id('ses');
  await stmt(env.DB, `INSERT INTO sessions(token_hash, org_id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)`,
    await sha256(token), env.DEMO_ORG_ID, user.id, id('csrf'), new Date(Date.now() + 8 * 3600_000).toISOString()).run();
  const authenticated = await authenticate(new Request(request.url, { headers: { Cookie: `${COOKIE}=${token}` } }), env);
  const { tokenHash, ...session } = authenticated;
  return json({ data: session }, 200, { 'Set-Cookie': cookie(request, token, 8 * 3600) });
}
export async function logout(request, env, session) {
  await stmt(env.DB, 'DELETE FROM sessions WHERE token_hash = ?', session.tokenHash).run();
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(request, '', 0), 'Cache-Control': 'no-store' } });
}
export function owner(session) { if (session.role !== 'OWNER') throw new HttpError(403, 'FORBIDDEN'); }

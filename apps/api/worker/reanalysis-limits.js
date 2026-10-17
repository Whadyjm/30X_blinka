import { HttpError, stmt } from './http.js';

export async function checkReanalysisLimit(db, orgId, documentSha256) {
  const usage = await stmt(db, `SELECT count(*) AS attempts, max(a.created_at) AS last_attempt_at
    FROM invoices i JOIN audit_events a ON a.org_id = i.org_id AND a.entity_id = i.id
    WHERE i.org_id = ? AND i.file_sha256 = ? AND a.type = 'INVOICE_REEVALUATED'`, orgId, documentSha256).first();
  if (usage.attempts >= 3) {
    throw new HttpError(409, 'REANALYSIS_LIMIT_REACHED',
      'Este documento alcanzó el máximo de tres reanálisis. Subir otra copia no reinicia el límite.');
  }
  const retryAfter = Math.ceil((Date.parse(usage.last_attempt_at) + 60000 - Date.now()) / 1000);
  if (retryAfter > 0) {
    const error = new HttpError(429, 'REANALYSIS_COOLDOWN', 'Espera un minuto entre reanálisis de este documento.');
    error.retryAfter = retryAfter;
    throw error;
  }
}

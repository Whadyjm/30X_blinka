import { ActivateMandateSchema, CreateAgreementSchema, CreateVendorSchema, MandateDraftSchema,
  SaveMandateDraftSchema, UpdateAgreementSchema, UpdateVendorSchema } from '@oli/contracts';
import { audit, body, clearGuard, guard, HttpError, id, json, normalizeName, now, periodKey, sha256, stmt } from './http.js';
import { agreementDto, budgetDto, idempotency, policyDto, vendorDto } from './repository.js';
import { owner } from './auth.js';

export const draftDto = r => r ? MandateDraftSchema.parse({ id: r.id, revision: r.revision,
  basedOnPolicyVersionId: r.based_on_policy_version_id, rules: JSON.parse(r.policy_json), updatedAt: r.updated_at }) : null;
export async function mandateState(db, orgId) {
  const rows = await db.batch([
    stmt(db, 'SELECT state_revision FROM organizations WHERE id = ?', orgId),
    stmt(db, "SELECT * FROM policy_versions WHERE org_id = ? AND status = 'ACTIVE'", orgId),
    stmt(db, 'SELECT * FROM policy_drafts WHERE org_id = ?', orgId),
  ]);
  return { revision: rows[0].results[0].state_revision, active: policyDto(rows[1].results[0]), draft: draftDto(rows[2].results[0]) };
}

export async function saveDraft(request, env, session) {
  owner(session);
  const input = await body(request, SaveMandateDraftSchema);
  const orgId = session.organization.id;
  const state = await mandateState(env.DB, orgId);
  if (input.basedOnPolicyVersionId !== (state.active?.id ?? null)) throw new HttpError(409, 'POLICY_CHANGED');
  if (input.expectedRevision !== (state.draft?.revision ?? null)) throw new HttpError(409, 'DRAFT_CHANGED');
  const draft = { id: state.draft?.id ?? id('draft'), revision: (state.draft?.revision ?? 0) + 1,
    basedOnPolicyVersionId: input.basedOnPolicyVersionId, rules: input.rules, updatedAt: now() };
  const guardId = id('guard');
  // Draft updates participate in the organization revision, just like active configuration.
  await env.DB.batch([
    guard(env.DB, orgId, state.revision, guardId),
    stmt(env.DB, `INSERT INTO policy_drafts(id, org_id, revision, based_on_policy_version_id, policy_json, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(org_id) DO UPDATE SET revision = excluded.revision,
      based_on_policy_version_id = excluded.based_on_policy_version_id, policy_json = excluded.policy_json,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`, draft.id, orgId, draft.revision,
    draft.basedOnPolicyVersionId, JSON.stringify(draft.rules), session.user.id, draft.updatedAt),
    stmt(env.DB, 'UPDATE organizations SET state_revision = state_revision + 1 WHERE id = ?', orgId),
    audit(env.DB, orgId, session.user.id, 'MANDATE_DRAFT_SAVED', draft.id, { revision: draft.revision }),
    clearGuard(env.DB, guardId),
  ]).catch(error => { if (/CHECK constraint failed: valid/.test(String(error))) throw new HttpError(409, 'DRAFT_CHANGED'); throw error; });
  return json({ data: draft });
}

export async function activateMandate(request, env, session) {
  owner(session);
  const input = await body(request, ActivateMandateSchema);
  const idem = await idempotency(request, env.DB, session, await sha256(JSON.stringify(input)));
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const orgId = session.organization.id;
  const state = await mandateState(env.DB, orgId);
  if ((state.active?.id ?? null) !== input.expectedActivePolicyVersionId) throw new HttpError(409, 'POLICY_CHANGED');
  if (!state.draft || state.draft.id !== input.draftId || state.draft.revision !== input.expectedRevision) throw new HttpError(409, 'DRAFT_CHANGED');
  if (state.draft.basedOnPolicyVersionId !== (state.active?.id ?? null)) throw new HttpError(409, 'POLICY_CHANGED');
  const rules = SaveMandateDraftSchema.parse({ expectedRevision: state.draft.revision,
    basedOnPolicyVersionId: state.draft.basedOnPolicyVersionId, rules: state.draft.rules }).rules;
  const key = periodKey(session.organization.timezone);
  const budgets = (await stmt(env.DB, 'SELECT * FROM budget_periods WHERE org_id = ? AND period_key = ?', orgId, key).all()).results;
  if (budgets.some(b => b.currency !== rules.currency && b.reserved_minor > 0)) throw new HttpError(409, 'CURRENCY_CHANGE_CONFLICT');
  const budget = budgets.find(b => b.currency === rules.currency);
  if (budget && budget.reserved_minor > rules.monthlyBudgetMinor) throw new HttpError(409, 'BUDGET_LIMIT_CONFLICT');
  const policy = { id: id('pol'), version: (state.active?.version ?? 0) + 1, status: 'ACTIVE', rules,
    activatedAt: now(), activatedBy: session.user.id };
  const response = { data: policy }; const guardId = id('guard');
  try {
    await env.DB.batch([
      guard(env.DB, orgId, state.revision, guardId),
      stmt(env.DB, "UPDATE policy_versions SET status = 'SUPERSEDED' WHERE org_id = ? AND status = 'ACTIVE'", orgId),
      stmt(env.DB, `INSERT INTO policy_versions(id, org_id, version, status, policy_json, created_by, created_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`, policy.id, orgId, policy.version, JSON.stringify(rules), session.user.id, policy.activatedAt),
      stmt(env.DB, `INSERT INTO budget_periods(id, org_id, currency, period_key, limit_minor) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(org_id, currency, period_key) DO UPDATE SET limit_minor = excluded.limit_minor`,
      id('budget'), orgId, rules.currency, key, rules.monthlyBudgetMinor),
      stmt(env.DB, "UPDATE approval_requests SET state = 'INVALIDATED', decided_at = ? WHERE org_id = ? AND state = 'PENDING'", policy.activatedAt, orgId),
      stmt(env.DB, 'DELETE FROM policy_drafts WHERE org_id = ?', orgId),
      audit(env.DB, orgId, session.user.id, 'MANDATE_ACTIVATED', policy.id, { previousPolicyId: state.active?.id ?? null, rules }, policy.activatedAt),
      idem.save(response), clearGuard(env.DB, guardId),
    ]);
  } catch (error) {
    const replay = await idempotency(request, env.DB, session, await sha256(JSON.stringify(input)));
    if (replay.cached) return json(replay.cached.body, replay.cached.status);
    if (/CHECK constraint failed: valid/.test(String(error))) throw new HttpError(409, 'POLICY_CHANGED');
    throw error;
  }
  return json(response);
}

export async function mutateDirectory(request, env, session, kind, resourceId) {
  owner(session);
  const vendor = kind === 'vendors';
  const schema = vendor ? (resourceId ? UpdateVendorSchema : CreateVendorSchema) : (resourceId ? UpdateAgreementSchema : CreateAgreementSchema);
  const input = await body(request, schema); const orgId = session.organization.id;
  const revision = await stmt(env.DB, 'SELECT state_revision FROM organizations WHERE id = ?', orgId).first('state_revision');
  const old = resourceId ? await stmt(env.DB, `SELECT * FROM ${kind} WHERE id = ? AND org_id = ?`, resourceId, orgId).first() : null;
  if (resourceId && !old) throw new HttpError(404, 'NOT_FOUND');
  const data = { ...(old ? (vendor ? vendorDto(old) : agreementDto(old)) : {}), ...input,
    id: resourceId ?? id(vendor ? 'vendor' : 'agr'), createdAt: old?.created_at ?? now() };
  if (!vendor && !await stmt(env.DB, 'SELECT id FROM vendors WHERE org_id = ? AND id = ?', orgId, data.vendorId).first()) throw new HttpError(404, 'NOT_FOUND');
  const guardId = id('guard');
  const mutation = directoryMutation(env.DB, orgId, kind, data, resourceId);
  try {
    await env.DB.batch([guard(env.DB, orgId, revision, guardId), mutation,
      audit(env.DB, orgId, session.user.id, resourceId ? 'DIRECTORY_UPDATED' : 'DIRECTORY_CREATED', data.id, { kind, ...input }), clearGuard(env.DB, guardId)]);
  } catch (error) {
    if (/CHECK constraint failed: valid|UNIQUE constraint|FOREIGN KEY constraint/.test(String(error))) throw new HttpError(409, 'CONFIGURATION_CONFLICT', 'La configuración cambió o el registro ya está en uso. Recarga e intenta nuevamente.');
    throw error;
  }
  return json({ data }, resourceId ? 200 : 201);
}

// Shared by ordinary forms and confirmed chat actions; callers supply authorization and transaction guards.
export function directoryMutation(db, orgId, kind, data, resourceId = null) {
  if (kind === 'vendors') return resourceId
    ? stmt(db, 'UPDATE vendors SET name = ?, normalized_name = ?, allowed = ?, external_ref = ? WHERE id = ? AND org_id = ?', data.name, normalizeName(data.name), Number(data.allowed), data.externalRef, data.id, orgId)
    : stmt(db, 'INSERT INTO vendors(id, org_id, name, normalized_name, allowed, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', data.id, orgId, data.name, normalizeName(data.name), Number(data.allowed), data.externalRef, data.createdAt);
  return resourceId
    ? stmt(db, `UPDATE agreements SET vendor_id = ?, currency = ?, amount_minor = ?, tolerance_minor = ?, frequency = ?, concept = ?, active = ? WHERE id = ? AND org_id = ?`,
      data.vendorId, data.currency, data.amountMinor, data.toleranceMinor, data.frequency, data.concept, Number(data.active), data.id, orgId)
    : stmt(db, `INSERT INTO agreements(id, org_id, vendor_id, currency, amount_minor, tolerance_minor, frequency, concept, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, orgId, data.vendorId, data.currency, data.amountMinor, data.toleranceMinor, data.frequency, data.concept, Number(data.active), data.createdAt);
}
export async function budgets(db, orgId, key) {
  return (await stmt(db, 'SELECT * FROM budget_periods WHERE org_id = ? AND period_key = ? ORDER BY currency', orgId, key).all()).results.map(budgetDto);
}

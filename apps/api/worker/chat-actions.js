import { ChatActionInputSchema, ChatActionSchema, ChatActionResultSchema, ConfirmChatActionSchema,
  ChatCardSchema, checkExtraction } from '@oli/contracts';
import { owner } from './auth.js';
import { audit, body, clearGuard, guard, HttpError, id, json, normalizeName, now, sha256, stmt } from './http.js';
import { agreementDto, getInvoice, idempotency, vendorDto } from './repository.js';
import { directoryMutation } from './configuration.js';
import { decisionStatements, evaluateStored, snapshot } from './processing.js';

const revision = (db, org) => stmt(db, 'SELECT state_revision FROM organizations WHERE id = ?', org).first('state_revision');
export const actionDto = row => ChatActionSchema.parse({ id: row.id, proposal: JSON.parse(row.proposal_json),
  before: JSON.parse(row.before_json), status: row.state === 'PENDING' && row.expires_at <= now() ? 'EXPIRED' : row.state,
  createdAt: row.created_at, expiresAt: row.expires_at });

export async function inspectInvoice(env, session, invoiceId) {
  const org = session.organization.id;
  const invoice = await getInvoice(env.DB, org, invoiceId);
  const raw = await stmt(env.DB, 'SELECT * FROM invoices WHERE org_id = ? AND id = ?', org, invoiceId).first();
  const read = raw.extracted_json ? JSON.parse(raw.extracted_json) : null;
  const check = read ? checkExtraction({ documentSha256: raw.file_sha256, primaryReadId: read.primaryReadId,
    candidate: read.extraction, corroboration: read.corroboration }) : null;
  // Match the domain engine's actual name, including legacy seed rows with shortened normalized_name.
  const matches = invoice.vendorName ? (await stmt(env.DB, 'SELECT * FROM vendors WHERE org_id = ?', org).all()).results
    .filter(v => normalizeName(v.name) === normalizeName(invoice.vendorName)) : [];
  const reserved = await stmt(env.DB, 'SELECT 1 AS yes FROM budget_reservations WHERE org_id = ? AND invoice_id = ?', org, invoiceId).first();
  let status = 'PROCESSING';
  if (invoice.status === 'FAILED') status = 'FAILED';
  else if (invoice.status === 'DECIDED') status = check?.status !== 'CROSS_CHECKED' ? 'EXTRACTION_REVIEW'
    : matches.length > 1 ? 'AMBIGUOUS_VENDOR' : !matches.length ? 'UNKNOWN_VENDOR'
      : matches[0].allowed ? 'KNOWN_VENDOR' : 'DISALLOWED_VENDOR';
  const unresolved = session.role === 'OWNER' && !reserved && !raw.vendor_id && !raw.agreement_id
    && invoice.status === 'DECIDED' && invoice.latestDecision?.action === 'BLOCK'
    && invoice.latestDecision.reasons.includes('UNKNOWN_VENDOR') && check?.status === 'CROSS_CHECKED';
  return ChatCardSchema.parse({ type: 'INVOICE', invoice, intake: { status,
    canOnboard: !!unresolved && status === 'UNKNOWN_VENDOR', canResume: !!unresolved && status === 'KNOWN_VENDOR',
    expectedDecisionId: invoice.latestDecision?.id ?? null, suggestedVendorName: invoice.vendorName,
    suggestedAgreement: read ? { currency: invoice.currency, amountMinor: invoice.amountMinor,
      concept: invoice.description, servicePeriod: invoice.servicePeriod } : null } });
}

async function buildChange(env, session, proposal) {
  const db = env.DB, org = session.organization.id;
  const mutations = [];
  let before = null, vendor = null, agreement = null, reevaluation = null;
  if (proposal.kind === 'ONBOARD_INVOICE_VENDOR' || proposal.kind === 'RESUME_INVOICE') {
    const card = await inspectInvoice(env, session, proposal.invoiceId);
    if (card.intake.expectedDecisionId !== proposal.expectedDecisionId) throw new HttpError(409, 'DECISION_CHANGED');
    if (!(proposal.kind === 'RESUME_INVOICE' ? card.intake.canResume : card.intake.canOnboard)) throw new HttpError(409, 'VENDOR_ONBOARDING_NOT_ALLOWED');
    const state = await snapshot(db, org, proposal.invoiceId);
    if (proposal.kind === 'ONBOARD_INVOICE_VENDOR') {
      if (normalizeName(proposal.vendor.name) !== normalizeName(card.invoice.vendorName)) throw new HttpError(400, 'VENDOR_IDENTITY_MISMATCH');
      vendor = { ...proposal.vendor, id: id('vendor'), createdAt: now() };
      mutations.push(directoryMutation(db, org, 'vendors', vendor));
      state.context.vendors.push(vendor);
      if (proposal.agreement) {
        agreement = { ...proposal.agreement, vendorId: vendor.id, id: id('agr'), createdAt: now() };
        state.context.agreements.push(agreement);
        mutations.push(directoryMutation(db, org, 'agreements', agreement));
      }
    } else vendor = state.context.vendors.find(v => normalizeName(v.name) === normalizeName(card.invoice.vendorName));
    const stored = JSON.parse(state.invoice.extracted_json);
    const evaluation = evaluateStored(stored, state);
    if (state.context.policy.rules.requireAgreement && !evaluation.agreementId) throw new HttpError(409, 'AGREEMENT_REQUIRED', 'Confirma un acuerdo activo para el concepto y moneda de esta factura.');
    if (evaluation.vendorId !== vendor.id) throw new HttpError(409, 'VENDOR_IDENTITY_MISMATCH');
    if (!agreement && evaluation.agreementId) agreement = state.context.agreements.find(a => a.id === evaluation.agreementId);
    reevaluation = { state, stored, evaluation };
  } else {
    const isVendor = proposal.kind.endsWith('VENDOR');
    const table = isVendor ? 'vendors' : 'agreements';
    const old = proposal.targetId ? await stmt(db, `SELECT * FROM ${table} WHERE org_id = ? AND id = ?`, org, proposal.targetId).first() : null;
    if (proposal.targetId && !old) throw new HttpError(404, 'NOT_FOUND');
    before = old ? (isVendor ? vendorDto(old) : agreementDto(old)) : null;
    const data = { ...before, ...proposal.data, id: proposal.targetId ?? id(isVendor ? 'vendor' : 'agr'), createdAt: before?.createdAt ?? now() };
    if (isVendor && (await stmt(db, 'SELECT id, name FROM vendors WHERE org_id = ?', org).all()).results
      .some(v => v.id !== data.id && normalizeName(v.name) === normalizeName(data.name))) throw new HttpError(409, 'CONFIGURATION_CONFLICT', 'Ese proveedor ya existe.');
    if (!isVendor && !await stmt(db, 'SELECT id FROM vendors WHERE org_id = ? AND id = ?', org, data.vendorId).first()) throw new HttpError(404, 'NOT_FOUND');
    mutations.push(directoryMutation(db, org, table, data, proposal.targetId));
    if (isVendor) vendor = data; else agreement = data;
  }
  return { before, vendor, agreement, mutations, reevaluation };
}

export async function prepareAction(env, session, raw) {
  owner(session);
  const parsed = ChatActionInputSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Revisa los datos de la propuesta.');
  const proposal = parsed.data;
  const baseRevision = await revision(env.DB, session.organization.id);
  const change = await buildChange(env, session, proposal);
  if (baseRevision !== await revision(env.DB, session.organization.id)) throw new HttpError(409, 'ACTION_STALE');
  const createdAt = now(), expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const action = ChatActionSchema.parse({ id: id('act'), proposal, before: change.before, status: 'PENDING', createdAt, expiresAt });
  return { action, baseRevision };
}
export function actionInsert(db, session, prepared) {
  const { action, baseRevision } = prepared;
  return stmt(db, `INSERT INTO chat_actions(id, org_id, user_id, proposal_json, before_json, base_revision, state, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`, action.id, session.organization.id, session.user.id,
    JSON.stringify(action.proposal), JSON.stringify(action.before), baseRevision, action.createdAt, action.expiresAt);
}
export async function prepareActionRequest(request, env, session) {
  owner(session);
  const raw = await body(request, ChatActionInputSchema);
  const idem = await idempotency(request, env.DB, session, await sha256(JSON.stringify(raw)));
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const prepared = await prepareAction(env, session, raw);
  const response = { data: prepared.action };
  try { await env.DB.batch([actionInsert(env.DB, session, prepared), idem.save(response, 201)]); }
  catch (e) { const replay = await idempotency(request, env.DB, session, await sha256(JSON.stringify(raw))); if (replay.cached) return json(replay.cached.body, replay.cached.status); throw e; }
  return json(response, 201);
}

export async function getAction(env, session, actionId) {
  const row = await stmt(env.DB, 'SELECT * FROM chat_actions WHERE org_id = ? AND user_id = ? AND id = ?', session.organization.id, session.user.id, actionId).first();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}
export async function confirmAction(request, env, session, actionId) {
  owner(session);
  const input = await body(request, ConfirmChatActionSchema);
  const idem = await idempotency(request, env.DB, session, await sha256(JSON.stringify(input)));
  if (idem.cached) return json(idem.cached.body, idem.cached.status);
  const row = await getAction(env, session, actionId);
  if (row.state === 'CONFIRMED') return json(JSON.parse(row.result_json));
  if (actionDto(row).status !== 'PENDING') throw new HttpError(409, 'ACTION_NOT_PENDING');
  const org = session.organization.id;
  if (row.base_revision !== await revision(env.DB, org)) throw new HttpError(409, 'ACTION_STALE', 'Los datos cambiaron. Prepara y revisa una propuesta nueva.');
  const action = actionDto(row);
  const change = await buildChange(env, session, action.proposal);
  const guardId = id('guard'), actionGuard = id('guard');
  const statements = [guard(env.DB, org, row.base_revision, guardId),
    stmt(env.DB, `INSERT INTO commit_guards(id, valid) VALUES (?, EXISTS(SELECT 1 FROM chat_actions a JOIN memberships m
      ON m.org_id = a.org_id AND m.user_id = a.user_id WHERE a.id = ? AND a.org_id = ? AND a.user_id = ?
      AND a.state = 'PENDING' AND a.expires_at > ? AND m.role = 'OWNER'))`, actionGuard, actionId, org, session.user.id, now()), ...change.mutations];
  let invoice = null;
  if (change.reevaluation) {
    const { state, stored, evaluation } = change.reevaluation;
    const approvalId = id('apr');
    statements.push(stmt(env.DB, `INSERT INTO invoice_vendor_resolutions(org_id, invoice_id, previous_decision_id,
      vendor_id, agreement_id, action_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, org, state.invoice.id,
      action.proposal.expectedDecisionId, evaluation.vendorId, evaluation.agreementId, action.id, session.user.id, now()),
    stmt(env.DB, 'UPDATE invoices SET vendor_id = ?, agreement_id = ? WHERE org_id = ? AND id = ?', evaluation.vendorId, evaluation.agreementId, org, state.invoice.id),
    ...decisionStatements(env.DB, org, evaluation, stored, null, approvalId),
    audit(env.DB, org, session.user.id, 'INVOICE_VENDOR_RESOLVED', state.invoice.id,
      { actionId: action.id, previousDecisionId: action.proposal.expectedDecisionId, decisionId: evaluation.candidate.id }));
    const old = await getInvoice(env.DB, org, state.invoice.id);
    invoice = { ...old, vendorId: evaluation.vendorId, agreementId: evaluation.agreementId,
      latestDecision: evaluation.candidate, decisions: [...old.decisions, evaluation.candidate], updatedAt: evaluation.candidate.checkedAt };
    if (evaluation.candidate.needsHumanApproval) {
      invoice.approvalRequest = { id: approvalId, invoiceId: invoice.id, decisionId: evaluation.candidate.id,
        policyVersionId: evaluation.candidate.policyVersionId, state: 'PENDING', reason: evaluation.candidate.humanExplanation,
        canApprove: true, reviewerId: null, reviewComment: null, createdAt: evaluation.candidate.checkedAt, decidedAt: null };
    }
  }
  const result = ChatActionResultSchema.parse({ action: { ...action, status: 'CONFIRMED' }, vendor: change.vendor, agreement: change.agreement, invoice });
  const response = { data: result };
  // Confirmation and all effects commit together; D1 resolution triggers require this confirmed record.
  statements.splice(2, 0, stmt(env.DB, "UPDATE chat_actions SET state = 'CONFIRMED', result_json = ? WHERE id = ? AND org_id = ? AND state = 'PENDING'", JSON.stringify(response), actionId, org));
  statements.push(audit(env.DB, org, session.user.id, 'CHAT_ACTION_CONFIRMED', actionId, { proposal: action.proposal, before: action.before }),
    idem.save(response), clearGuard(env.DB, guardId), clearGuard(env.DB, actionGuard));
  try { await env.DB.batch(statements); }
  catch (error) {
    const committed = await getAction(env, session, actionId);
    if (committed.state === 'CONFIRMED') return json(JSON.parse(committed.result_json));
    if (/CHECK constraint|UNIQUE constraint|FOREIGN KEY|POLICY_CHANGED|BUDGET_EXCEEDED|IMMUTABLE|INVALID_INVOICE_RESOLUTION/.test(String(error))) throw new HttpError(409, 'ACTION_STALE');
    throw error;
  }
  return json(response);
}
export async function cancelAction(request, env, session, actionId) {
  owner(session);
  const row = await getAction(env, session, actionId);
  if (row.state === 'CONFIRMED') throw new HttpError(409, 'ACTION_NOT_PENDING');
  const guardId = id('guard');
  if (row.state === 'PENDING') {
    try { await env.DB.batch([
      stmt(env.DB, "INSERT INTO commit_guards(id, valid) VALUES (?, EXISTS(SELECT 1 FROM chat_actions WHERE id = ? AND org_id = ? AND state = 'PENDING'))", guardId, actionId, session.organization.id),
      stmt(env.DB, "UPDATE chat_actions SET state = 'CANCELLED' WHERE org_id = ? AND user_id = ? AND id = ? AND state = 'PENDING'", session.organization.id, session.user.id, actionId),
      audit(env.DB, session.organization.id, session.user.id, 'CHAT_ACTION_CANCELLED', actionId, {}), clearGuard(env.DB, guardId)]); }
    catch (e) { if (!/CHECK constraint/.test(String(e))) throw e; }
  }
  if ((await getAction(env, session, actionId)).state === 'CONFIRMED') throw new HttpError(409, 'ACTION_NOT_PENDING');
  return json({ data: actionDto(await getAction(env, session, actionId)) });
}

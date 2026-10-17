import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()
  .map(file => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
const seed = readFileSync(new URL('../seed/demo.sql', import.meta.url), 'utf8');
const statements = (sql) => sql.split('\n-- statement-breakpoint\n').map((part) => part.trim()).filter(Boolean);

async function database(t) {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Local D1 storage tests"); } };',
    // Fecha del runtime fijado en este harness; no configura el Worker de la app.
    compatibilityDate: '2026-07-30',
    d1Databases: { DB: 'oli-local-storage-test' },
    d1Persist: false,
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  for (const migration of migrations) await db.batch(statements(migration).map((sql) => db.prepare(sql)));
  await db.batch(statements(seed).map((sql) => db.prepare(sql)));
  return db;
}

async function invoice(db, id, changes = {}) {
  const data = {
    orgId: 'org_demo', vendorId: 'vendor_demo_cloud', agreementId: 'agr_demo_cloud',
    amount: 20000, currency: 'USD', invoiceNumber: id, servicePeriod: '2026-10',
    hash: createHash('sha256').update(id).digest('hex'), ...changes,
  };
  await db.prepare(`INSERT INTO invoices (
    id, org_id, vendor_id, agreement_id, amount_minor, currency, invoice_no,
    normalized_invoice_no, due_date, service_period, file_key, file_name,
    file_mime_type, file_size_bytes, file_sha256, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-31', ?, ?, 'demo.pdf', 'application/pdf', 100, ?, 'READY')`)
    .bind(id, data.orgId, data.vendorId, data.agreementId, data.amount, data.currency,
      data.invoiceNumber, data.invoiceNumber, data.servicePeriod, `synthetic-test/${id}.pdf`, data.hash).run();
}

function decision(db, id, invoiceId, options = {}) {
  const data = { action: 'APPROVE', policyId: 'pol_demo_v1', needsHuman: 0, ...options };
  return db.prepare(`INSERT INTO decisions (
    id, org_id, invoice_id, action, policy_version_id, budget_period_id,
    reason_codes_json, evidence_json, human_explanation, needs_human_approval, actor_kind
  ) VALUES (?, 'org_demo', ?, ?, ?, ?, '["POLICY_ALLOWED"]', '{"storageTestOnly":true}',
    'Fixture de persistencia; no constituye una evaluación del motor.', ?, 'SYSTEM')`)
    .bind(id, invoiceId, data.action, data.policyId,
      data.action === 'APPROVE' ? 'budget_demo_current' : null, data.needsHuman);
}

async function ledger(db) {
  return {
    approved: await db.prepare("SELECT count(*) AS n FROM decisions WHERE action = 'APPROVE'").first('n'),
    reservations: await db.prepare('SELECT count(*) AS n FROM budget_reservations').first('n'),
    reserved: await db.prepare("SELECT reserved_minor FROM budget_periods WHERE id = 'budget_demo_current'").first('reserved_minor'),
  };
}

test('migración y seed crean empresa ficticia coherente, sin credenciales ni aprobaciones inventadas', async (t) => {
  const db = await database(t);
  const org = await db.prepare('SELECT * FROM organizations').first();
  assert.equal(org.is_demo, 1);
  assert.equal(org.default_currency, 'USD');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM users WHERE auth_subject IS NOT NULL').first('n'), 0);
  const policy = JSON.parse(await db.prepare('SELECT policy_json FROM policy_versions').first('policy_json'));
  assert.equal(policy.automaticLimitMinor, 30000);
  assert.equal(policy.hardLimitMinor, 100000);
  assert.equal(policy.monthlyBudgetMinor, 200000);
  assert.deepEqual(await ledger(db), { approved: 0, reservations: 0, reserved: 0 });
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
});

test('aprobar guarda decisión, reserva e importe de presupuesto en la misma operación', async (t) => {
  const db = await database(t);
  await invoice(db, 'invoice_1');
  await decision(db, 'decision_1', 'invoice_1').run();
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
  assert.equal(await db.prepare("SELECT status FROM invoices WHERE id = 'invoice_1'").first('status'), 'DECIDED');
  await assert.rejects(decision(db, 'decision_retry', 'invoice_1').run(), /UNIQUE constraint/);
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
});

test('dos aprobaciones concurrentes no gastan 400 cuando solo quedan 300', async (t) => {
  const db = await database(t);
  await db.prepare("UPDATE budget_periods SET limit_minor = 30000 WHERE id = 'budget_demo_current'").run();
  await invoice(db, 'invoice_a');
  await invoice(db, 'invoice_b', { servicePeriod: '2026-11' });
  const results = await Promise.allSettled([
    decision(db, 'decision_a', 'invoice_a').run(),
    decision(db, 'decision_b', 'invoice_b').run(),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failed = results.find((result) => result.status === 'rejected');
  assert.match(String(failed.reason), /BUDGET_EXCEEDED/);
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
  assert.equal(await db.prepare("SELECT count(*) AS n FROM invoices WHERE status = 'READY'").first('n'), 1);
});

test('dos solicitudes simultáneas para la misma factura reservan una sola vez', async (t) => {
  const db = await database(t);
  await invoice(db, 'concurrent_duplicate');
  const results = await Promise.allSettled([
    decision(db, 'first_attempt', 'concurrent_duplicate').run(),
    decision(db, 'second_attempt', 'concurrent_duplicate').run(),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
});

test('un batch fallido revierte también reservas y cambios previos de estado', async (t) => {
  const db = await database(t);
  await invoice(db, 'invoice_batch');
  await assert.rejects(db.batch([
    decision(db, 'decision_batch', 'invoice_batch'),
    db.prepare("INSERT INTO organizations (id, name, default_currency, timezone) VALUES ('org_demo', 'Duplicado', 'USD', 'UTC')"),
  ]), /UNIQUE constraint/);
  assert.deepEqual(await ledger(db), { approved: 0, reservations: 0, reserved: 0 });
  assert.equal(await db.prepare("SELECT status FROM invoices WHERE id = 'invoice_batch'").first('status'), 'READY');
});

test('duplicados se conservan para auditoría pero no reciben dos reservas', async (t) => {
  const db = await database(t);
  await invoice(db, 'original');
  await decision(db, 'decision_original', 'original').run();
  await invoice(db, 'same_file', { hash: createHash('sha256').update('original').digest('hex'), servicePeriod: '2026-11' });
  await invoice(db, 'same_number', { invoiceNumber: 'original', servicePeriod: '2026-12' });
  await invoice(db, 'same_obligation');
  for (const id of ['same_file', 'same_number', 'same_obligation']) {
    await assert.rejects(decision(db, `decision_${id}`, id).run(), /UNIQUE constraint/);
    await decision(db, `blocked_${id}`, id, { action: 'BLOCK' }).run();
  }
  assert.equal(await db.prepare('SELECT count(*) AS n FROM invoices').first('n'), 4);
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
});

test('restricciones de moneda y datos incompletos fallan sin dejar una aprobación', async (t) => {
  const db = await database(t);
  for (const [id, changes] of [
    ['euro', { currency: 'EUR' }],
    ['missing_amount', { amount: null }],
    ['missing_period', { servicePeriod: null }],
  ]) {
    await invoice(db, id, changes);
    await assert.rejects(decision(db, `decision_${id}`, id).run(), /INVALID_APPROVAL_CONTEXT/);
  }
  assert.deepEqual(await ledger(db), { approved: 0, reservations: 0, reserved: 0 });
});

test('claves compuestas rechazan referencias cruzadas entre organizaciones y proveedores', async (t) => {
  const db = await database(t);
  await db.prepare("INSERT INTO organizations (id, name, default_currency, timezone) VALUES ('org_other', 'Otra demo', 'USD', 'UTC')").run();
  await assert.rejects(invoice(db, 'cross_org', { orgId: 'org_other' }), /FOREIGN KEY constraint/);
  await assert.rejects(invoice(db, 'wrong_vendor', { vendorId: 'vendor_demo_acme' }), /FOREIGN KEY constraint/);
});

test('política activa es única, contenido inmutable y solo owner crea versiones', async (t) => {
  const db = await database(t);
  await assert.rejects(db.prepare("UPDATE policy_versions SET policy_json = '{}' WHERE id = 'pol_demo_v1'").run(), /POLICY_IMMUTABLE/);
  await assert.rejects(db.prepare("DELETE FROM policy_versions WHERE id = 'pol_demo_v1'").run(), /POLICY_IMMUTABLE/);
  await assert.rejects(db.prepare(`INSERT INTO policy_versions (id, org_id, version, status, policy_json, created_by)
    VALUES ('pol_demo_v2', 'org_demo', 2, 'ACTIVE', '{}', 'user_demo_owner')`).run(), /UNIQUE constraint/);
  await assert.rejects(db.prepare(`INSERT INTO policy_versions (id, org_id, version, status, policy_json, created_by)
    VALUES ('pol_demo_v2', 'org_demo', 2, 'SUPERSEDED', '{}', 'user_demo_approver')`).run(), /OWNER_REQUIRED/);
  await invoice(db, 'stale_policy');
  await db.prepare("UPDATE policy_versions SET status = 'SUPERSEDED' WHERE id = 'pol_demo_v1'").run();
  await assert.rejects(decision(db, 'stale_decision', 'stale_policy').run(), /POLICY_CHANGED/);
  await assert.rejects(db.prepare("UPDATE policy_versions SET status = 'ACTIVE' WHERE id = 'pol_demo_v1'").run(), /POLICY_IMMUTABLE/);
});

test('historial, reservas y hechos de una factura decidida no se reescriben', async (t) => {
  const db = await database(t);
  await invoice(db, 'immutable_invoice');
  await decision(db, 'immutable_decision', 'immutable_invoice').run();
  for (const sql of [
    "UPDATE decisions SET action = 'BLOCK' WHERE id = 'immutable_decision'",
    "DELETE FROM decisions WHERE id = 'immutable_decision'",
    'UPDATE budget_reservations SET amount_minor = 1',
    'DELETE FROM budget_reservations',
    "UPDATE invoices SET amount_minor = 1 WHERE id = 'immutable_invoice'",
    "UPDATE audit_events SET details_json = '{}'",
    'DELETE FROM audit_events',
  ]) await assert.rejects(db.prepare(sql).run(), /IMMUTABLE/);
});

test('el contador no se reinicia y el límite no baja por debajo de reservas existentes', async (t) => {
  const db = await database(t);
  await invoice(db, 'budget_guards');
  await decision(db, 'decision_guards', 'budget_guards').run();
  await assert.rejects(db.prepare('UPDATE budget_periods SET reserved_minor = 0').run(), /BUDGET_LEDGER_MISMATCH/);
  await assert.rejects(db.prepare('UPDATE budget_periods SET limit_minor = 10000').run(), /CHECK constraint/);
  await assert.rejects(db.prepare("UPDATE budget_periods SET currency = 'EUR'").run(), /BUDGET_IDENTITY_IMMUTABLE/);
  assert.deepEqual(await ledger(db), { approved: 1, reservations: 1, reserved: 20000 });
});

test('solo escalaciones autorizables originan solicitudes humanas', async (t) => {
  const db = await database(t);
  await invoice(db, 'human_review');
  await decision(db, 'needs_review', 'human_review', { action: 'ESCALATE', needsHuman: 1 }).run();
  await db.prepare(`INSERT INTO approval_requests (id, org_id, invoice_id, decision_id, policy_version_id, reason)
    VALUES ('approval_1', 'org_demo', 'human_review', 'needs_review', 'pol_demo_v1', 'Revisión autorizable')`).run();
  await assert.rejects(db.prepare(`INSERT INTO approval_requests (id, org_id, invoice_id, decision_id, policy_version_id, reason)
    VALUES ('approval_2', 'org_demo', 'human_review', 'needs_review', 'pol_demo_v1', 'Repetido')`).run(), /UNIQUE constraint/);
  await invoice(db, 'illegible');
  await decision(db, 'not_authorizable', 'illegible', { action: 'ESCALATE' }).run();
  await assert.rejects(db.prepare(`INSERT INTO approval_requests (id, org_id, invoice_id, decision_id, policy_version_id, reason)
    VALUES ('approval_3', 'org_demo', 'illegible', 'not_authorizable', 'pol_demo_v1', 'No se permite')`).run(), /APPROVAL_NOT_ALLOWED/);
});

test('enteros seguros, importes positivos y periodos válidos también se exigen en SQL', async (t) => {
  const db = await database(t);
  for (const [id, changes] of [
    ['zero', { amount: 0 }], ['float', { amount: 200.5 }],
    ['unsafe', { amount: Number.MAX_SAFE_INTEGER + 1 }], ['bad_period', { servicePeriod: '2026-13' }],
  ]) await assert.rejects(invoice(db, id, changes));
  assert.deepEqual(await ledger(db), { approved: 0, reservations: 0, reserved: 0 });
});

test('claves de idempotencia se aíslan por actor/ruta y no admiten respuestas incompletas', async (t) => {
  const db = await database(t);
  const insert = db.prepare(`INSERT INTO idempotency_keys
    (org_id, actor_id, route, key, request_hash, state)
    VALUES ('org_demo', ?, ?, 'key_test', 'hash_test', 'PROCESSING')`);
  await insert.bind('user_demo_owner', '/invoices').run();
  await assert.rejects(insert.bind('user_demo_owner', '/invoices').run(), /UNIQUE constraint/);
  await insert.bind('user_demo_approver', '/invoices').run();
  await insert.bind('user_demo_owner', '/mandate/activate').run();
  await assert.rejects(db.prepare("UPDATE idempotency_keys SET state = 'COMPLETED', response_json = '{}' WHERE actor_id = 'user_demo_owner'").run(), /CHECK constraint/);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM idempotency_keys').first('n'), 3);
});

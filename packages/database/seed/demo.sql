-- Solo empresa/personas/proveedores ficticios. Sin passwords ni identidades habilitadas.
-- Ejecutar una sola vez por BD demo nueva, después de las migraciones.
INSERT INTO organizations (id, name, default_currency, timezone)
VALUES ('org_demo', 'Lumen Atlas — empresa ficticia', 'USD', 'America/Caracas');
-- statement-breakpoint
INSERT INTO users (id, name, email) VALUES
  ('user_demo_owner', 'Demo Owner', 'owner@oli-demo.invalid'),
  ('user_demo_approver', 'Demo Approver', 'approver@oli-demo.invalid');
-- statement-breakpoint
INSERT INTO memberships (org_id, user_id, role) VALUES
  ('org_demo', 'user_demo_owner', 'OWNER'),
  ('org_demo', 'user_demo_approver', 'APPROVER');
-- statement-breakpoint
INSERT INTO policy_versions (id, org_id, version, status, policy_json, created_by)
VALUES ('pol_demo_v1', 'org_demo', 1, 'ACTIVE',
  '{"currency":"USD","automaticLimitMinor":30000,"hardLimitMinor":100000,"monthlyBudgetMinor":200000,"requireAllowedVendor":true,"requireAgreement":true,"humanApprovalEnabled":true,"reviewAboveMinor":30000,"processDaysBeforeDue":0,"scopedDelegations":[]}',
  'user_demo_owner');
-- statement-breakpoint
INSERT INTO vendors (id, org_id, name, normalized_name, allowed, external_ref) VALUES
  ('vendor_demo_acme', 'org_demo', 'Acme Accounting (ficticio)', 'acme accounting', 1, 'DEMO-ACME'),
  ('vendor_demo_cloud', 'org_demo', 'Demo Cloud Hosting (ficticio)', 'demo cloud hosting', 1, 'DEMO-CLOUD'),
  ('vendor_demo_blocked', 'org_demo', 'Proveedor no permitido (ficticio)', 'proveedor no permitido', 0, NULL);
-- statement-breakpoint
INSERT INTO agreements (id, org_id, vendor_id, currency, amount_minor, tolerance_minor, frequency, concept, active) VALUES
  ('agr_demo_acme', 'org_demo', 'vendor_demo_acme', 'USD', 45000, 0, 'MONTHLY', 'Contabilidad mensual ficticia', 1),
  ('agr_demo_cloud', 'org_demo', 'vendor_demo_cloud', 'USD', 20000, 0, 'MONTHLY', 'Hosting mensual ficticio', 1);
-- statement-breakpoint
-- Periodo según la zona de la empresa demo (UTC-4), no un mes fijo que expire.
INSERT INTO budget_periods (id, org_id, currency, period_key, limit_minor)
VALUES ('budget_demo_current', 'org_demo', 'USD', strftime('%Y-%m', 'now', '-4 hours'), 200000);
-- statement-breakpoint
INSERT INTO audit_events (id, org_id, actor_kind, type, entity_id, details_json)
VALUES ('audit_demo_seed', 'org_demo', 'SYSTEM', 'DEMO_DATA_SEEDED', 'org_demo',
  '{"synthetic":true,"source":"packages/database/seed/demo.sql","note":"Configuración ficticia; sin pagos ni aprobaciones históricas inventadas."}');

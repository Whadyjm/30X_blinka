-- P0: datos ficticios, decisiones simuladas. Sin tablas de pagos bancarios.
-- Los separadores permiten ejecutar sentencias completas (incluidos triggers) en tests D1.
CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  default_currency TEXT NOT NULL CHECK(length(default_currency) = 3 AND default_currency = upper(default_currency)),
  timezone TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo = 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
-- statement-breakpoint
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  auth_subject TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
-- statement-breakpoint
CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'APPROVER')),
  PRIMARY KEY(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE policy_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  based_on_policy_version_id TEXT,
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json) AND json_type(policy_json) = 'object'),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(org_id, updated_by) REFERENCES memberships(org_id, user_id),
  FOREIGN KEY(org_id, based_on_policy_version_id) REFERENCES policy_versions(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  version INTEGER NOT NULL CHECK(version > 0),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUPERSEDED')),
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json) AND json_type(policy_json) = 'object'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, id),
  UNIQUE(org_id, version),
  FOREIGN KEY(org_id, created_by) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX one_active_policy_per_org ON policy_versions(org_id) WHERE status = 'ACTIVE';
-- statement-breakpoint
CREATE TRIGGER policy_versions_owner_only BEFORE INSERT ON policy_versions BEGIN
  SELECT RAISE(ABORT, 'OWNER_REQUIRED') WHERE NOT EXISTS (
    SELECT 1 FROM memberships WHERE org_id = NEW.org_id AND user_id = NEW.created_by AND role = 'OWNER'
  );
END;
-- statement-breakpoint
CREATE TRIGGER policy_versions_content_immutable
BEFORE UPDATE OF id, org_id, version, policy_json, created_by, created_at ON policy_versions BEGIN
  SELECT RAISE(ABORT, 'POLICY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER policy_versions_no_reactivation BEFORE UPDATE OF status ON policy_versions
WHEN OLD.status <> 'ACTIVE' OR NEW.status <> 'SUPERSEDED' BEGIN
  SELECT RAISE(ABORT, 'POLICY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER policy_versions_no_delete BEFORE DELETE ON policy_versions BEGIN
  SELECT RAISE(ABORT, 'POLICY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TABLE vendors (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name) > 0),
  allowed INTEGER NOT NULL CHECK(allowed IN (0, 1)),
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, id),
  UNIQUE(org_id, normalized_name)
) STRICT;
-- statement-breakpoint
CREATE TABLE agreements (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  vendor_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency) = 3 AND currency = upper(currency)),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  tolerance_minor INTEGER NOT NULL DEFAULT 0 CHECK(tolerance_minor BETWEEN 0 AND 9007199254740991),
  frequency TEXT NOT NULL CHECK(frequency IN ('ONE_TIME', 'MONTHLY')),
  concept TEXT NOT NULL CHECK(length(trim(concept)) > 0),
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, id),
  UNIQUE(org_id, id, vendor_id),
  FOREIGN KEY(org_id, vendor_id) REFERENCES vendors(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE TABLE budget_periods (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  currency TEXT NOT NULL CHECK(length(currency) = 3 AND currency = upper(currency)),
  period_key TEXT NOT NULL CHECK(period_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(period_key, 6, 2) BETWEEN '01' AND '12'),
  limit_minor INTEGER NOT NULL CHECK(limit_minor BETWEEN 0 AND 9007199254740991),
  reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK(reserved_minor >= 0 AND reserved_minor <= limit_minor),
  UNIQUE(org_id, id),
  UNIQUE(org_id, currency, period_key)
) STRICT;
-- statement-breakpoint
CREATE TABLE invoices (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  source_kind TEXT NOT NULL DEFAULT 'HUMAN_UPLOAD' CHECK(source_kind = 'HUMAN_UPLOAD'),
  vendor_id TEXT,
  agreement_id TEXT,
  vendor_name TEXT,
  invoice_no TEXT,
  normalized_invoice_no TEXT CHECK(normalized_invoice_no IS NULL OR length(normalized_invoice_no) > 0),
  amount_minor INTEGER CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT CHECK(currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))),
  issued_at TEXT,
  due_date TEXT,
  service_period TEXT CHECK(service_period IS NULL OR (service_period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(service_period, 6, 2) BETWEEN '01' AND '12')),
  description TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_mime_type TEXT NOT NULL CHECK(file_mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes BETWEEN 1 AND 5242880),
  file_sha256 TEXT NOT NULL CHECK(length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  extracted_json TEXT CHECK(extracted_json IS NULL OR json_valid(extracted_json)),
  extraction_warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(extraction_warnings_json) AND json_type(extraction_warnings_json) = 'array'),
  processing_error_json TEXT CHECK(processing_error_json IS NULL OR json_valid(processing_error_json)),
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED', 'PARSING', 'READY', 'PROCESSING', 'DECIDED', 'FAILED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, id),
  CHECK(agreement_id IS NULL OR vendor_id IS NOT NULL),
  FOREIGN KEY(org_id, vendor_id) REFERENCES vendors(org_id, id),
  FOREIGN KEY(org_id, agreement_id, vendor_id) REFERENCES agreements(org_id, id, vendor_id)
) STRICT;
-- statement-breakpoint
CREATE INDEX invoices_by_status ON invoices(org_id, status, created_at DESC);
-- statement-breakpoint
CREATE INDEX invoices_by_due_date ON invoices(org_id, due_date);
-- statement-breakpoint
CREATE INDEX invoices_by_hash ON invoices(org_id, file_sha256);
-- statement-breakpoint
CREATE INDEX invoices_by_number ON invoices(org_id, vendor_id, normalized_invoice_no);
-- statement-breakpoint
CREATE TABLE decisions (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  invoice_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('APPROVE', 'BLOCK', 'ESCALATE')),
  policy_version_id TEXT NOT NULL,
  budget_period_id TEXT,
  reason_codes_json TEXT NOT NULL CHECK(json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array' AND json_array_length(reason_codes_json) > 0),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
  human_explanation TEXT NOT NULL CHECK(length(trim(human_explanation)) > 0),
  needs_human_approval INTEGER NOT NULL CHECK(needs_human_approval IN (0, 1)),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('SYSTEM', 'HUMAN')),
  actor_id TEXT,
  simulated INTEGER NOT NULL DEFAULT 1 CHECK(simulated = 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, id),
  UNIQUE(org_id, id, invoice_id),
  CHECK((actor_kind = 'SYSTEM' AND actor_id IS NULL) OR (actor_kind = 'HUMAN' AND actor_id IS NOT NULL)),
  CHECK(needs_human_approval = 0 OR action = 'ESCALATE'),
  CHECK(action <> 'APPROVE' OR budget_period_id IS NOT NULL),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id),
  FOREIGN KEY(org_id, policy_version_id) REFERENCES policy_versions(org_id, id),
  FOREIGN KEY(org_id, budget_period_id) REFERENCES budget_periods(org_id, id),
  FOREIGN KEY(org_id, actor_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE INDEX decisions_by_invoice ON decisions(org_id, invoice_id, created_at, id);
-- statement-breakpoint
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  invoice_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED')),
  reason TEXT NOT NULL,
  reviewer_id TEXT,
  review_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  UNIQUE(org_id, id),
  FOREIGN KEY(org_id, decision_id, invoice_id) REFERENCES decisions(org_id, id, invoice_id),
  FOREIGN KEY(org_id, policy_version_id) REFERENCES policy_versions(org_id, id),
  FOREIGN KEY(org_id, reviewer_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX one_pending_approval_per_invoice ON approval_requests(org_id, invoice_id) WHERE state = 'PENDING';
-- statement-breakpoint
CREATE INDEX approvals_by_state ON approval_requests(org_id, state, created_at DESC);
-- statement-breakpoint
CREATE TRIGGER approval_requires_escalation BEFORE INSERT ON approval_requests BEGIN
  SELECT RAISE(ABORT, 'APPROVAL_NOT_ALLOWED') WHERE NOT EXISTS (
    SELECT 1 FROM decisions WHERE id = NEW.decision_id AND org_id = NEW.org_id
      AND invoice_id = NEW.invoice_id AND action = 'ESCALATE' AND needs_human_approval = 1
      AND policy_version_id = NEW.policy_version_id
  );
END;
-- statement-breakpoint
CREATE TABLE budget_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  invoice_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  budget_period_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL,
  vendor_id TEXT,
  normalized_invoice_no TEXT,
  file_sha256 TEXT NOT NULL,
  agreement_id TEXT,
  agreement_frequency TEXT CHECK(agreement_frequency IN ('ONE_TIME', 'MONTHLY')),
  service_period TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status = 'ACTIVE'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, invoice_id),
  UNIQUE(org_id, decision_id),
  UNIQUE(org_id, file_sha256),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id),
  FOREIGN KEY(org_id, decision_id, invoice_id) REFERENCES decisions(org_id, id, invoice_id),
  FOREIGN KEY(org_id, budget_period_id) REFERENCES budget_periods(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX one_reserved_invoice_number ON budget_reservations(org_id, vendor_id, normalized_invoice_no)
WHERE normalized_invoice_no IS NOT NULL AND vendor_id IS NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX one_reserved_monthly_obligation ON budget_reservations(org_id, agreement_id, service_period)
WHERE agreement_frequency = 'MONTHLY';
-- statement-breakpoint
CREATE UNIQUE INDEX one_reserved_one_time_obligation ON budget_reservations(org_id, agreement_id)
WHERE agreement_frequency = 'ONE_TIME';
-- statement-breakpoint
CREATE TRIGGER approval_requires_current_policy BEFORE INSERT ON decisions WHEN NEW.action = 'APPROVE' BEGIN
  SELECT RAISE(ABORT, 'POLICY_CHANGED') WHERE NOT EXISTS (
    SELECT 1 FROM policy_versions WHERE id = NEW.policy_version_id AND org_id = NEW.org_id AND status = 'ACTIVE'
  );
END;
-- statement-breakpoint
-- Una sola sentencia confirma decisión + reserva + contador o revierte todo.
CREATE TRIGGER approve_reserves_budget AFTER INSERT ON decisions WHEN NEW.action = 'APPROVE' BEGIN
  SELECT RAISE(ABORT, 'INVALID_APPROVAL_CONTEXT') WHERE NOT EXISTS (
    SELECT 1 FROM invoices i JOIN budget_periods b ON b.id = NEW.budget_period_id AND b.org_id = NEW.org_id
    LEFT JOIN agreements a ON a.id = i.agreement_id AND a.org_id = i.org_id
    WHERE i.id = NEW.invoice_id AND i.org_id = NEW.org_id AND i.amount_minor IS NOT NULL
      AND i.currency = b.currency AND i.due_date IS NOT NULL
      AND (a.frequency IS NULL OR a.frequency <> 'MONTHLY' OR i.service_period IS NOT NULL)
  );
  INSERT INTO budget_reservations (
    id, org_id, invoice_id, decision_id, budget_period_id, amount_minor, currency,
    vendor_id, normalized_invoice_no, file_sha256, agreement_id, agreement_frequency, service_period, created_at
  ) SELECT 'res_' || NEW.id, i.org_id, i.id, NEW.id, NEW.budget_period_id, i.amount_minor, i.currency,
    i.vendor_id, i.normalized_invoice_no, i.file_sha256, i.agreement_id, a.frequency, i.service_period, NEW.created_at
    FROM invoices i LEFT JOIN agreements a ON a.id = i.agreement_id AND a.org_id = i.org_id
    WHERE i.id = NEW.invoice_id AND i.org_id = NEW.org_id;
END;
-- statement-breakpoint
CREATE TRIGGER reservation_requires_approval BEFORE INSERT ON budget_reservations BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_REQUIRES_APPROVAL') WHERE NOT EXISTS (
    SELECT 1 FROM decisions d JOIN invoices i ON i.id = d.invoice_id AND i.org_id = d.org_id
    WHERE d.id = NEW.decision_id AND d.org_id = NEW.org_id AND d.invoice_id = NEW.invoice_id
      AND d.action = 'APPROVE' AND d.budget_period_id = NEW.budget_period_id
      AND i.amount_minor = NEW.amount_minor AND i.currency = NEW.currency AND i.file_sha256 = NEW.file_sha256
  );
END;
-- statement-breakpoint
CREATE TRIGGER reservation_increments_budget AFTER INSERT ON budget_reservations BEGIN
  UPDATE budget_periods SET reserved_minor = reserved_minor + NEW.amount_minor
    WHERE id = NEW.budget_period_id AND org_id = NEW.org_id
      AND currency = NEW.currency AND NEW.amount_minor <= limit_minor - reserved_minor;
  SELECT RAISE(ABORT, 'BUDGET_EXCEEDED') WHERE changes() <> 1;
END;
-- statement-breakpoint
CREATE TRIGGER budget_counter_matches_reservations BEFORE UPDATE OF reserved_minor ON budget_periods BEGIN
  SELECT RAISE(ABORT, 'BUDGET_LEDGER_MISMATCH') WHERE NEW.reserved_minor <> (
    SELECT coalesce(sum(amount_minor), 0) FROM budget_reservations WHERE budget_period_id = OLD.id AND org_id = OLD.org_id
  );
END;
-- statement-breakpoint
CREATE TRIGGER new_budget_starts_empty BEFORE INSERT ON budget_periods WHEN NEW.reserved_minor <> 0 BEGIN
  SELECT RAISE(ABORT, 'BUDGET_LEDGER_MISMATCH');
END;
-- statement-breakpoint
CREATE TRIGGER budget_identity_immutable BEFORE UPDATE OF id, org_id, currency, period_key ON budget_periods BEGIN
  SELECT RAISE(ABORT, 'BUDGET_IDENTITY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER reservations_no_update BEFORE UPDATE ON budget_reservations BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON budget_reservations BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN
  SELECT RAISE(ABORT, 'DECISION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions BEGIN
  SELECT RAISE(ABORT, 'DECISION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER decision_updates_invoice AFTER INSERT ON decisions BEGIN
  UPDATE invoices SET status = 'DECIDED', updated_at = NEW.created_at WHERE id = NEW.invoice_id AND org_id = NEW.org_id;
END;
-- statement-breakpoint
CREATE TRIGGER decided_invoice_facts_immutable
BEFORE UPDATE OF id, org_id, vendor_id, agreement_id, vendor_name, invoice_no, normalized_invoice_no,
  amount_minor, currency, issued_at, due_date, service_period, description, file_key, file_name,
  file_mime_type, file_size_bytes, file_sha256, extracted_json ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE invoice_id = OLD.id AND org_id = OLD.org_id) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('SYSTEM', 'HUMAN')),
  actor_id TEXT,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK(json_valid(details_json) AND json_type(details_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK((actor_kind = 'SYSTEM' AND actor_id IS NULL) OR (actor_kind = 'HUMAN' AND actor_id IS NOT NULL)),
  FOREIGN KEY(org_id, actor_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE INDEX audit_by_entity ON audit_events(org_id, entity_id, created_at);
-- statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TABLE idempotency_keys (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PROCESSING', 'COMPLETED')),
  response_status INTEGER,
  response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(org_id, actor_id, route, key),
  CHECK((state = 'PROCESSING' AND response_status IS NULL AND response_json IS NULL)
    OR (state = 'COMPLETED' AND response_status IS NOT NULL AND response_status BETWEEN 100 AND 599 AND response_json IS NOT NULL)),
  FOREIGN KEY(org_id, actor_id) REFERENCES memberships(org_id, user_id)
) STRICT;

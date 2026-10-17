-- An invoice and its processing intent are created in the same D1 transaction.
CREATE TABLE invoice_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','RETRY','DONE','DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  lease_token TEXT,
  lease_until TEXT,
  next_attempt_at TEXT,
  enqueued_at TEXT,
  last_error_json TEXT CHECK(last_error_json IS NULL OR json_valid(last_error_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(org_id, invoice_id),
  UNIQUE(org_id, id),
  CHECK((state = 'RUNNING' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'RUNNING' AND lease_token IS NULL AND lease_until IS NULL)),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE INDEX invoice_jobs_dispatch ON invoice_jobs(state, next_attempt_at, enqueued_at);
-- statement-breakpoint
CREATE INDEX invoice_jobs_leases ON invoice_jobs(state, lease_until);
-- statement-breakpoint
CREATE TABLE invoice_job_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES invoice_jobs(id),
  state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','RETRY','DONE','DEAD')),
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 3),
  lease_token TEXT,
  error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL
) STRICT;
-- statement-breakpoint
CREATE INDEX invoice_job_events_history ON invoice_job_events(job_id, sequence);
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_insert_event AFTER INSERT ON invoice_jobs BEGIN
  INSERT INTO invoice_job_events(job_id, state, attempt, lease_token, error_json, created_at)
    VALUES (NEW.id, NEW.state, NEW.attempts, NEW.lease_token, NEW.last_error_json, NEW.updated_at);
END;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_update_event AFTER UPDATE ON invoice_jobs
WHEN NEW.state <> OLD.state OR NEW.attempts <> OLD.attempts OR NEW.lease_token IS NOT OLD.lease_token
  OR NEW.last_error_json IS NOT OLD.last_error_json BEGIN
  INSERT INTO invoice_job_events(job_id, state, attempt, lease_token, error_json, created_at)
    VALUES (NEW.id, NEW.state, NEW.attempts, NEW.lease_token, NEW.last_error_json, NEW.updated_at);
END;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_identity_immutable BEFORE UPDATE OF id, org_id, invoice_id, created_at ON invoice_jobs BEGIN
  SELECT RAISE(ABORT, 'JOB_IDENTITY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_attempts_monotonic BEFORE UPDATE OF attempts ON invoice_jobs
WHEN NEW.attempts < OLD.attempts BEGIN
  SELECT RAISE(ABORT, 'JOB_ATTEMPTS_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_terminal BEFORE UPDATE OF state ON invoice_jobs
WHEN OLD.state IN ('DONE','DEAD') AND NEW.state <> OLD.state BEGIN
  SELECT RAISE(ABORT, 'JOB_TERMINAL');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_no_delete BEFORE DELETE ON invoice_jobs BEGIN
  SELECT RAISE(ABORT, 'JOB_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_job_events_no_update BEFORE UPDATE ON invoice_job_events BEGIN
  SELECT RAISE(ABORT, 'JOB_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_job_events_no_delete BEFORE DELETE ON invoice_job_events BEGIN
  SELECT RAISE(ABORT, 'JOB_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoices_create_job AFTER INSERT ON invoices BEGIN
  INSERT INTO invoice_jobs(id, org_id, invoice_id, state, next_attempt_at, created_at, updated_at)
    VALUES ('invoice_job:' || NEW.id, NEW.org_id, NEW.id,
      CASE WHEN NEW.status = 'DECIDED' THEN 'DONE'
        WHEN NEW.status = 'FAILED' AND coalesce(json_extract(NEW.processing_error_json, '$.retryable'), 0) = 0 THEN 'DEAD'
        ELSE 'PENDING' END,
      NEW.created_at, NEW.created_at, NEW.created_at);
END;
-- statement-breakpoint
INSERT INTO invoice_jobs(id, org_id, invoice_id, state, next_attempt_at, created_at, updated_at)
  SELECT 'invoice_job:' || id, org_id, id,
    CASE WHEN status = 'DECIDED' THEN 'DONE'
      WHEN status = 'FAILED' AND coalesce(json_extract(processing_error_json, '$.retryable'), 0) = 0 THEN 'DEAD'
      ELSE 'PENDING' END,
    created_at, created_at, updated_at FROM invoices;
-- statement-breakpoint
-- Cache reads, never financial decisions; tenant/hash/config/kind are all part of identity.
CREATE TABLE document_read_artifacts (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  document_sha256 TEXT NOT NULL CHECK(length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'),
  reader_version TEXT NOT NULL CHECK(length(reader_version) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK(kind IN ('PRIMARY','SECONDARY')),
  artifact_json TEXT NOT NULL CHECK(json_valid(artifact_json) AND length(CAST(artifact_json AS BLOB)) <= 262144),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(org_id, document_sha256, reader_version, kind)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER document_read_artifacts_no_update BEFORE UPDATE ON document_read_artifacts BEGIN
  SELECT RAISE(ABORT, 'READ_ARTIFACT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER document_read_artifacts_no_delete BEFORE DELETE ON document_read_artifacts BEGIN
  SELECT RAISE(ABORT, 'READ_ARTIFACT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE INDEX invoices_created_page ON invoices(org_id, created_at DESC, id DESC);
-- statement-breakpoint
CREATE INDEX invoices_normalized_number ON invoices(org_id, normalized_invoice_no);
-- statement-breakpoint
CREATE INDEX invoices_amount_currency_date ON invoices(org_id, amount_minor, currency, issued_at);
-- statement-breakpoint
CREATE INDEX decisions_latest ON decisions(org_id, invoice_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX approvals_latest ON approval_requests(org_id, invoice_id, created_at DESC);

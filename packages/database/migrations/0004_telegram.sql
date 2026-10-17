CREATE TABLE telegram_connections (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX telegram_active_identity ON telegram_connections(telegram_user_id) WHERE revoked_at IS NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX telegram_active_member ON telegram_connections(org_id, user_id) WHERE revoked_at IS NULL;
-- statement-breakpoint
CREATE TABLE telegram_link_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  connection_id TEXT REFERENCES telegram_connections(id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE telegram_events (
  update_id INTEGER PRIMARY KEY NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  connection_id TEXT REFERENCES telegram_connections(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','DONE','FAILED')),
  lease_token TEXT,
  lease_until TEXT,
  reply_text TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
-- statement-breakpoint
-- Preserve the legacy invoices table and all financial triggers; channel provenance is append-only.
CREATE TABLE invoice_sources (
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'TELEGRAM'),
  telegram_update_id INTEGER NOT NULL UNIQUE REFERENCES telegram_events(update_id),
  PRIMARY KEY(org_id, invoice_id),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER invoice_sources_immutable BEFORE UPDATE ON invoice_sources BEGIN
  SELECT RAISE(ABORT, 'SOURCE_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_sources_no_delete BEFORE DELETE ON invoice_sources BEGIN
  SELECT RAISE(ABORT, 'SOURCE_IMMUTABLE');
END;

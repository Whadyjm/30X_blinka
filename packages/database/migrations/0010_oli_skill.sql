CREATE TABLE agent_connections (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  UNIQUE(org_id, id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE agent_request_limits (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_connections(id),
  window_start INTEGER NOT NULL,
  requests INTEGER NOT NULL
) STRICT;
-- statement-breakpoint
CREATE TABLE agent_invoice_sources (
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  PRIMARY KEY(org_id, invoice_id),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id),
  FOREIGN KEY(org_id, connection_id) REFERENCES agent_connections(org_id, id)
) STRICT;
-- statement-breakpoint
CREATE INDEX agent_invoices_by_connection ON agent_invoice_sources(org_id, connection_id, invoice_id);
-- statement-breakpoint
CREATE TRIGGER agent_source_no_update BEFORE UPDATE ON agent_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER agent_source_no_delete BEFORE DELETE ON agent_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER agent_source_exclusive BEFORE INSERT ON agent_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM invoice_channel_sources WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id
  );
END;
-- statement-breakpoint
CREATE TRIGGER email_source_no_agent BEFORE INSERT ON email_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM agent_invoice_sources WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id
  );
END;
-- statement-breakpoint
CREATE TRIGGER telegram_source_no_agent BEFORE INSERT ON invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM agent_invoice_sources WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id
  );
END;
-- statement-breakpoint
DROP VIEW invoice_channel_sources;
-- statement-breakpoint
CREATE VIEW invoice_channel_sources AS
  SELECT org_id,invoice_id,kind FROM invoice_sources
  UNION ALL SELECT org_id,invoice_id,'EMAIL' AS kind FROM email_invoice_sources
  UNION ALL SELECT org_id,invoice_id,'AGENT_REQUEST' AS kind FROM agent_invoice_sources;

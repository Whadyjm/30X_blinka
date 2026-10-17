-- Snapshots are checked again inside the same transaction that commits a decision.
ALTER TABLE organizations ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE invoices ADD COLUMN processing_token TEXT;
-- statement-breakpoint
ALTER TABLE invoices ADD COLUMN processing_started_at TEXT;
-- statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;
-- statement-breakpoint
-- Insert and remove within a D1 batch; a stale snapshot aborts the entire batch.
CREATE TABLE commit_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK(valid = 1)
) STRICT;

-- statement-breakpoint
CREATE TRIGGER revision_vendors_insert AFTER INSERT ON vendors BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_vendors_update AFTER UPDATE ON vendors BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_vendors_delete AFTER DELETE ON vendors BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_agreements_insert AFTER INSERT ON agreements BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_agreements_update AFTER UPDATE ON agreements BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_agreements_delete AFTER DELETE ON agreements BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_policy_versions_insert AFTER INSERT ON policy_versions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_policy_versions_update AFTER UPDATE ON policy_versions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_policy_versions_delete AFTER DELETE ON policy_versions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_budget_periods_insert AFTER INSERT ON budget_periods BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_budget_periods_update AFTER UPDATE ON budget_periods BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_budget_periods_delete AFTER DELETE ON budget_periods BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_invoices_insert AFTER INSERT ON invoices BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_invoices_update AFTER UPDATE ON invoices BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_invoices_delete AFTER DELETE ON invoices BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_decisions_insert AFTER INSERT ON decisions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_decisions_update AFTER UPDATE ON decisions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = NEW.org_id;
END;

-- statement-breakpoint
CREATE TRIGGER revision_decisions_delete AFTER DELETE ON decisions BEGIN
  UPDATE organizations SET state_revision = state_revision + 1 WHERE id = OLD.org_id;
END;

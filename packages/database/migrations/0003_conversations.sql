CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org_id, user_id, id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  user_text TEXT NOT NULL,
  invoice_ids_json TEXT NOT NULL CHECK(json_valid(invoice_ids_json)),
  state TEXT NOT NULL CHECK(state IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  lease_token TEXT,
  started_at TEXT NOT NULL,
  response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  UNIQUE(org_id, user_id, client_key),
  FOREIGN KEY(org_id, user_id, conversation_id) REFERENCES chat_conversations(org_id, user_id, id)
) STRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX chat_single_turn ON chat_turns(conversation_id) WHERE state = 'PROCESSING';
-- statement-breakpoint
CREATE INDEX chat_turn_history ON chat_turns(org_id, user_id, conversation_id, created_at);
-- statement-breakpoint
CREATE TABLE chat_actions (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  base_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(org_id, id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER chat_action_payload_immutable BEFORE UPDATE OF id, org_id, user_id, proposal_json, before_json,
  base_revision, created_at, expires_at ON chat_actions BEGIN
  SELECT RAISE(ABORT, 'ACTION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER chat_action_final BEFORE UPDATE ON chat_actions WHEN OLD.state <> 'PENDING' BEGIN
  SELECT RAISE(ABORT, 'ACTION_FINAL');
END;
-- statement-breakpoint
CREATE TABLE invoice_vendor_resolutions (
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  previous_decision_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  agreement_id TEXT,
  action_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(org_id, invoice_id),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id),
  FOREIGN KEY(org_id, previous_decision_id, invoice_id) REFERENCES decisions(org_id, id, invoice_id),
  FOREIGN KEY(org_id, vendor_id) REFERENCES vendors(org_id, id),
  FOREIGN KEY(org_id, agreement_id, vendor_id) REFERENCES agreements(org_id, id, vendor_id),
  FOREIGN KEY(org_id, action_id) REFERENCES chat_actions(org_id, id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER invoice_resolution_requires_confirmation BEFORE INSERT ON invoice_vendor_resolutions BEGIN
  SELECT RAISE(ABORT, 'INVALID_INVOICE_RESOLUTION') WHERE NOT EXISTS (
    SELECT 1 FROM invoices i JOIN decisions d ON d.org_id = i.org_id AND d.invoice_id = i.id
    JOIN chat_actions a ON a.org_id = i.org_id AND a.id = NEW.action_id
    JOIN memberships m ON m.org_id = i.org_id AND m.user_id = NEW.user_id
    WHERE i.org_id = NEW.org_id AND i.id = NEW.invoice_id AND i.vendor_id IS NULL AND i.agreement_id IS NULL
      AND m.role = 'OWNER' AND a.user_id = NEW.user_id AND a.state = 'CONFIRMED' AND a.result_json IS NOT NULL
      AND json_extract(a.proposal_json, '$.kind') IN ('ONBOARD_INVOICE_VENDOR', 'RESUME_INVOICE')
      AND json_extract(a.proposal_json, '$.invoiceId') = i.id
      AND json_extract(a.proposal_json, '$.expectedDecisionId') = NEW.previous_decision_id
      AND a.expires_at > NEW.created_at
      AND d.id = NEW.previous_decision_id AND d.id = (SELECT id FROM decisions WHERE org_id = i.org_id AND invoice_id = i.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
      AND EXISTS (SELECT 1 FROM json_each(d.reason_codes_json) WHERE value = 'UNKNOWN_VENDOR')
      AND NOT EXISTS (SELECT 1 FROM decisions WHERE org_id = i.org_id AND invoice_id = i.id AND action = 'APPROVE')
      AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id = i.org_id AND invoice_id = i.id)
  );
END;
-- statement-breakpoint
CREATE TRIGGER invoice_resolution_no_update BEFORE UPDATE ON invoice_vendor_resolutions BEGIN
  SELECT RAISE(ABORT, 'RESOLUTION_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_resolution_no_delete BEFORE DELETE ON invoice_vendor_resolutions BEGIN
  SELECT RAISE(ABORT, 'RESOLUTION_IMMUTABLE');
END;
-- statement-breakpoint
DROP TRIGGER decided_invoice_facts_immutable;
-- statement-breakpoint
-- All original extraction/document facts stay immutable. Only unresolved relational IDs have a narrow exception.
CREATE TRIGGER decided_invoice_facts_immutable
BEFORE UPDATE OF id, org_id, vendor_name, invoice_no, normalized_invoice_no,
  amount_minor, currency, issued_at, due_date, service_period, description, file_key, file_name,
  file_mime_type, file_size_bytes, file_sha256, extracted_json ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE invoice_id = OLD.id AND org_id = OLD.org_id) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER decided_invoice_identity_immutable BEFORE UPDATE OF vendor_id, agreement_id ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE invoice_id = OLD.id AND org_id = OLD.org_id) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE') WHERE NOT (
    OLD.vendor_id IS NULL AND OLD.agreement_id IS NULL AND EXISTS (
      SELECT 1 FROM invoice_vendor_resolutions r JOIN chat_actions a ON a.id = r.action_id AND a.org_id = r.org_id
      WHERE r.org_id = OLD.org_id AND r.invoice_id = OLD.id AND r.vendor_id = NEW.vendor_id
        AND r.agreement_id IS NEW.agreement_id AND a.state = 'CONFIRMED'
        AND r.previous_decision_id = (SELECT id FROM decisions WHERE org_id = OLD.org_id AND invoice_id = OLD.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
    )
  );
END;

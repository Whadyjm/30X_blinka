-- Preserve every previous read before an owner requests a current reading of the same original.
CREATE TABLE invoice_rereads (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expected_decision_id TEXT NOT NULL,
  previous_read_json TEXT NOT NULL CHECK(json_valid(previous_read_json)),
  previous_facts_json TEXT NOT NULL CHECK(json_valid(previous_facts_json)),
  created_at TEXT NOT NULL,
  UNIQUE(org_id, invoice_id, expected_decision_id),
  FOREIGN KEY(org_id, invoice_id) REFERENCES invoices(org_id, id),
  FOREIGN KEY(org_id, expected_decision_id, invoice_id) REFERENCES decisions(org_id, id, invoice_id),
  FOREIGN KEY(org_id, user_id) REFERENCES memberships(org_id, user_id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER invoice_rereads_validate BEFORE INSERT ON invoice_rereads BEGIN
  SELECT RAISE(ABORT, 'REREAD_NOT_ALLOWED') WHERE NOT EXISTS (
    SELECT 1 FROM invoices i JOIN invoice_jobs j ON j.org_id=i.org_id AND j.invoice_id=i.id
    JOIN memberships m ON m.org_id=i.org_id AND m.user_id=NEW.user_id AND m.role='OWNER'
    WHERE i.org_id=NEW.org_id AND i.id=NEW.invoice_id AND i.status='DECIDED'
      AND i.extracted_json=NEW.previous_read_json AND j.state='DONE' AND j.attempts<3
      AND NEW.expected_decision_id=(SELECT id FROM decisions WHERE org_id=i.org_id AND invoice_id=i.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM decisions WHERE org_id=i.org_id AND invoice_id=i.id AND action='APPROVE')
      AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id=i.org_id AND invoice_id=i.id)
      AND NOT EXISTS (SELECT 1 FROM approval_requests WHERE org_id=i.org_id AND invoice_id=i.id AND state IN ('APPROVED','REJECTED'))
  );
END;
-- statement-breakpoint
CREATE TRIGGER invoice_rereads_no_update BEFORE UPDATE ON invoice_rereads BEGIN
  SELECT RAISE(ABORT, 'READ_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_rereads_no_delete BEFORE DELETE ON invoice_rereads BEGIN
  SELECT RAISE(ABORT, 'READ_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
DROP TRIGGER decided_invoice_facts_immutable;
-- statement-breakpoint
CREATE TRIGGER decided_invoice_document_immutable
BEFORE UPDATE OF id,org_id,file_key,file_name,file_mime_type,file_size_bytes,file_sha256 ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE');
END;
-- statement-breakpoint
-- Only an unresolved, explicitly requested read may replace the current projection.
CREATE TRIGGER decided_invoice_facts_immutable
BEFORE UPDATE OF vendor_name,invoice_no,normalized_invoice_no,
  amount_minor,currency,issued_at,due_date,service_period,description,extracted_json ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id)
AND NOT EXISTS (
  SELECT 1 FROM invoice_rereads r JOIN memberships m ON m.org_id=r.org_id AND m.user_id=r.user_id AND m.role='OWNER'
  JOIN invoice_jobs j ON j.org_id=r.org_id AND j.invoice_id=r.invoice_id
  WHERE r.org_id=OLD.org_id AND r.invoice_id=OLD.id
    AND r.expected_decision_id=(SELECT id FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id=OLD.org_id AND invoice_id=OLD.id)
    AND NOT EXISTS (SELECT 1 FROM approval_requests WHERE org_id=OLD.org_id AND invoice_id=OLD.id AND state IN ('APPROVED','REJECTED'))
    AND ((OLD.status='DECIDED' AND NEW.status='RECEIVED' AND NEW.extracted_json IS NULL AND j.state='DONE'
      AND NEW.vendor_id IS OLD.vendor_id AND NEW.agreement_id IS OLD.agreement_id
      AND NEW.vendor_name IS OLD.vendor_name AND NEW.invoice_no IS OLD.invoice_no
      AND NEW.normalized_invoice_no IS OLD.normalized_invoice_no AND NEW.amount_minor IS OLD.amount_minor
      AND NEW.currency IS OLD.currency AND NEW.issued_at IS OLD.issued_at AND NEW.due_date IS OLD.due_date
      AND NEW.service_period IS OLD.service_period AND NEW.description IS OLD.description)
      OR (OLD.status IN ('PARSING','PROCESSING') AND NEW.status IN ('PARSING','PROCESSING')
        AND OLD.processing_token IS NOT NULL AND NEW.processing_token IS OLD.processing_token AND j.state='RUNNING'))
) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE');
END;
-- statement-breakpoint
DROP TRIGGER invoice_jobs_terminal;
-- statement-breakpoint
CREATE TRIGGER invoice_jobs_terminal BEFORE UPDATE OF state ON invoice_jobs
WHEN OLD.state IN ('DONE','DEAD') AND NEW.state<>OLD.state
AND NOT (OLD.state='DONE' AND NEW.state='PENDING' AND NEW.attempts=OLD.attempts AND NEW.attempts<3 AND EXISTS (
  SELECT 1 FROM invoice_rereads r JOIN invoices i ON i.org_id=r.org_id AND i.id=r.invoice_id
  JOIN memberships m ON m.org_id=r.org_id AND m.user_id=r.user_id AND m.role='OWNER'
  WHERE r.org_id=OLD.org_id AND r.invoice_id=OLD.invoice_id AND i.status='RECEIVED' AND i.extracted_json IS NULL
    AND r.expected_decision_id=(SELECT id FROM decisions WHERE org_id=i.org_id AND invoice_id=i.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
)) BEGIN
  SELECT RAISE(ABORT, 'JOB_TERMINAL');
END;
-- statement-breakpoint
DROP TRIGGER decided_invoice_identity_immutable;
-- statement-breakpoint
CREATE TRIGGER decided_invoice_identity_immutable BEFORE UPDATE OF vendor_id,agreement_id ON invoices
WHEN EXISTS (SELECT 1 FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id) BEGIN
  SELECT RAISE(ABORT, 'INVOICE_FACTS_IMMUTABLE') WHERE NOT (
    (OLD.vendor_id IS NULL AND OLD.agreement_id IS NULL AND EXISTS (
      SELECT 1 FROM invoice_vendor_resolutions r JOIN chat_actions a ON a.id=r.action_id AND a.org_id=r.org_id
      WHERE r.org_id=OLD.org_id AND r.invoice_id=OLD.id AND r.vendor_id=NEW.vendor_id
        AND r.agreement_id IS NEW.agreement_id AND a.state='CONFIRMED'
        AND r.previous_decision_id=(SELECT id FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
    )) OR EXISTS (
      SELECT 1 FROM invoice_rereads r JOIN memberships m ON m.org_id=r.org_id AND m.user_id=r.user_id AND m.role='OWNER'
      JOIN invoice_jobs j ON j.org_id=r.org_id AND j.invoice_id=r.invoice_id
      WHERE r.org_id=OLD.org_id AND r.invoice_id=OLD.id AND j.state='RUNNING'
        AND OLD.status='PROCESSING' AND NEW.status='PROCESSING' AND OLD.processing_token IS NOT NULL AND NEW.processing_token IS OLD.processing_token
        AND r.expected_decision_id=(SELECT id FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id=OLD.org_id AND invoice_id=OLD.id)
        AND NOT EXISTS (SELECT 1 FROM approval_requests WHERE org_id=OLD.org_id AND invoice_id=OLD.id AND state IN ('APPROVED','REJECTED'))
    )
  );
END;

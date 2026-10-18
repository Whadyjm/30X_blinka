-- An explicit human confirmation is separate from machine readings and never edits them.
CREATE TABLE invoice_manual_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  previous_decision_id TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  previous_read_json TEXT NOT NULL CHECK(json_valid(previous_read_json)),
  review_json TEXT NOT NULL CHECK(json_valid(review_json)),
  comment TEXT NOT NULL CHECK(length(trim(comment)) BETWEEN 1 AND 1000),
  vendor_id TEXT,
  agreement_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(org_id,invoice_id,previous_decision_id),
  FOREIGN KEY(org_id,invoice_id) REFERENCES invoices(org_id,id),
  FOREIGN KEY(org_id,previous_decision_id,invoice_id) REFERENCES decisions(org_id,id,invoice_id),
  FOREIGN KEY(org_id,policy_version_id) REFERENCES policy_versions(org_id,id),
  FOREIGN KEY(org_id,user_id) REFERENCES memberships(org_id,user_id),
  FOREIGN KEY(org_id,vendor_id) REFERENCES vendors(org_id,id),
  FOREIGN KEY(org_id,agreement_id,vendor_id) REFERENCES agreements(org_id,id,vendor_id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER invoice_manual_reviews_validate BEFORE INSERT ON invoice_manual_reviews BEGIN
  SELECT RAISE(ABORT,'MANUAL_REVIEW_NOT_ALLOWED') WHERE NOT EXISTS (
    SELECT 1 FROM invoices i
    JOIN memberships m ON m.org_id=i.org_id AND m.user_id=NEW.user_id AND m.role IN ('OWNER','APPROVER')
    JOIN policy_versions p ON p.org_id=i.org_id AND p.id=NEW.policy_version_id AND p.status='ACTIVE'
    WHERE i.org_id=NEW.org_id AND i.id=NEW.invoice_id AND i.status='DECIDED'
      AND NEW.previous_read_json=i.extracted_json
      AND json_extract(i.extracted_json,'$.documentType')='INVOICE'
      AND json_extract(NEW.review_json,'$.documentSha256')=i.file_sha256
      AND json_extract(NEW.review_json,'$.primaryReadId')=json_extract(i.extracted_json,'$.primaryReadId')
      AND json_extract(NEW.review_json,'$.reviewerId')=NEW.user_id
      AND json_extract(NEW.review_json,'$.id')=NEW.id
      AND json_extract(NEW.review_json,'$.extraction')=json_extract(i.extracted_json,'$.extraction')
      AND NEW.previous_decision_id=(SELECT id FROM decisions WHERE org_id=i.org_id AND invoice_id=i.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM decisions WHERE org_id=i.org_id AND invoice_id=i.id AND action='APPROVE')
      AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id=i.org_id AND invoice_id=i.id)
      AND NOT EXISTS (SELECT 1 FROM approval_requests WHERE org_id=i.org_id AND invoice_id=i.id AND state IN ('APPROVED','REJECTED'))
  );
END;
-- statement-breakpoint
CREATE TRIGGER invoice_manual_reviews_no_update BEFORE UPDATE ON invoice_manual_reviews BEGIN
  SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER invoice_manual_reviews_no_delete BEFORE DELETE ON invoice_manual_reviews BEGIN
  SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE');
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
    ) OR EXISTS (
      SELECT 1 FROM invoice_manual_reviews r
      JOIN memberships m ON m.org_id=r.org_id AND m.user_id=r.user_id AND m.role IN ('OWNER','APPROVER')
      WHERE r.org_id=OLD.org_id AND r.invoice_id=OLD.id
        AND r.vendor_id IS NEW.vendor_id AND r.agreement_id IS NEW.agreement_id
        AND r.previous_decision_id=(SELECT id FROM decisions WHERE org_id=OLD.org_id AND invoice_id=OLD.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
        AND r.previous_read_json=OLD.extracted_json
        AND OLD.status='DECIDED' AND NEW.status='DECIDED'
        AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE org_id=OLD.org_id AND invoice_id=OLD.id)
    )
  );
END;

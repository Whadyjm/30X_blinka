-- Successful reanalyses share one lifetime allowance across copies of the same document in a tenant.
-- The audit insert is in the decision transaction, so a concurrent excess rolls everything back.
CREATE TRIGGER reanalysis_attempt_limit BEFORE INSERT ON audit_events
WHEN NEW.type = 'INVOICE_REEVALUATED' BEGIN
  SELECT RAISE(ABORT, 'REANALYSIS_LIMIT_REACHED') WHERE (
    SELECT count(*) FROM invoices i JOIN audit_events a ON a.org_id = i.org_id AND a.entity_id = i.id
    WHERE i.org_id = NEW.org_id AND a.type = 'INVOICE_REEVALUATED'
      AND i.file_sha256 = (SELECT file_sha256 FROM invoices WHERE org_id = NEW.org_id AND id = NEW.entity_id)
  ) >= 3;
  SELECT RAISE(ABORT, 'REANALYSIS_COOLDOWN') WHERE EXISTS (
    SELECT 1 FROM invoices i JOIN audit_events a ON a.org_id = i.org_id AND a.entity_id = i.id
    WHERE i.org_id = NEW.org_id AND a.type = 'INVOICE_REEVALUATED'
      AND i.file_sha256 = (SELECT file_sha256 FROM invoices WHERE org_id = NEW.org_id AND id = NEW.entity_id)
      AND a.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds')
  );
END;

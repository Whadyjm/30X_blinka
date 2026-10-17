CREATE TABLE email_mailboxes (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(org_id,id),
  FOREIGN KEY(org_id,user_id) REFERENCES memberships(org_id,user_id)
) STRICT;
-- statement-breakpoint
CREATE TABLE email_messages (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  message_key TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('RECEIVED','WAITING','COMPLETED','NO_DOCUMENT','FAILED')),
  error_code TEXT,
  lease_token TEXT,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL,
  enqueued_at TEXT,
  notified_at TEXT,
  UNIQUE(org_id,id),
  UNIQUE(org_id,message_key),
  FOREIGN KEY(org_id,mailbox_id) REFERENCES email_mailboxes(org_id,id)
) STRICT;
-- statement-breakpoint
CREATE INDEX email_message_recovery ON email_messages(notified_at,next_attempt_at,enqueued_at);
-- statement-breakpoint
CREATE INDEX email_message_inbox ON email_messages(org_id,received_at DESC,id);
-- statement-breakpoint
CREATE TABLE email_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  UNIQUE(org_id,id),
  UNIQUE(message_id,position),
  FOREIGN KEY(org_id,message_id) REFERENCES email_messages(org_id,id)
) STRICT;
-- statement-breakpoint
CREATE TABLE email_invoice_sources (
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(org_id,invoice_id),
  FOREIGN KEY(org_id,invoice_id) REFERENCES invoices(org_id,id),
  FOREIGN KEY(org_id,attachment_id) REFERENCES email_attachments(org_id,id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER email_source_no_update BEFORE UPDATE ON email_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER email_source_no_delete BEFORE DELETE ON email_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER email_source_exclusive BEFORE INSERT ON email_invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM invoice_sources WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id
  );
END;
-- statement-breakpoint
CREATE TRIGGER telegram_source_exclusive BEFORE INSERT ON invoice_sources BEGIN
  SELECT RAISE(ABORT,'SOURCE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM email_invoice_sources WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id
  );
END;
-- statement-breakpoint
CREATE VIEW invoice_channel_sources AS
  SELECT org_id,invoice_id,kind FROM invoice_sources
  UNION ALL SELECT org_id,invoice_id,'EMAIL' AS kind FROM email_invoice_sources;
-- statement-breakpoint
CREATE TABLE email_inbox_reads (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY(org_id,user_id,message_id),
  FOREIGN KEY(org_id,user_id) REFERENCES memberships(org_id,user_id),
  FOREIGN KEY(org_id,message_id) REFERENCES email_messages(org_id,id)
) STRICT;
-- statement-breakpoint
CREATE TABLE email_telegram_deliveries (
  org_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES telegram_connections(id),
  parts_json TEXT CHECK(parts_json IS NULL OR json_valid(parts_json)),
  delivered_parts INTEGER NOT NULL DEFAULT 0 CHECK(delivered_parts >= 0),
  delivered_at TEXT,
  PRIMARY KEY(message_id,connection_id),
  FOREIGN KEY(org_id,message_id) REFERENCES email_messages(org_id,id)
) STRICT;
-- statement-breakpoint
CREATE TRIGGER email_receipt_identity_immutable BEFORE UPDATE OF id,org_id,mailbox_id,message_key,sender,subject,received_at ON email_messages BEGIN
  SELECT RAISE(ABORT,'EMAIL_RECEIPT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER email_attachment_immutable BEFORE UPDATE ON email_attachments BEGIN
  SELECT RAISE(ABORT,'EMAIL_ATTACHMENT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER email_attachment_no_delete BEFORE DELETE ON email_attachments BEGIN
  SELECT RAISE(ABORT,'EMAIL_ATTACHMENT_IMMUTABLE');
END;
-- statement-breakpoint
CREATE TRIGGER email_mailbox_identity_immutable BEFORE UPDATE OF id,org_id,user_id,address,created_at ON email_mailboxes BEGIN
  SELECT RAISE(ABORT,'EMAIL_MAILBOX_IMMUTABLE');
END;

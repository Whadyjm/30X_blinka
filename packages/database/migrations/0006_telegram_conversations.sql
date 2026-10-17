CREATE UNIQUE INDEX telegram_connection_member ON telegram_connections(org_id, user_id, id);
-- statement-breakpoint
CREATE TABLE telegram_conversations (
  connection_id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_invoice_id TEXT,
  FOREIGN KEY(org_id, user_id, connection_id) REFERENCES telegram_connections(org_id, user_id, id),
  FOREIGN KEY(org_id, user_id, conversation_id) REFERENCES chat_conversations(org_id, user_id, id),
  FOREIGN KEY(org_id, last_invoice_id) REFERENCES invoices(org_id, id)
) STRICT;
-- statement-breakpoint
ALTER TABLE telegram_events ADD COLUMN reply_json TEXT CHECK(reply_json IS NULL OR json_valid(reply_json));
-- statement-breakpoint
ALTER TABLE telegram_events ADD COLUMN delivered_parts INTEGER NOT NULL DEFAULT 0 CHECK(delivered_parts >= 0);
-- statement-breakpoint
CREATE TABLE telegram_action_offers (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES telegram_connections(id),
  action_id TEXT NOT NULL REFERENCES chat_actions(id),
  update_id INTEGER NOT NULL REFERENCES telegram_events(update_id),
  message_id INTEGER,
  UNIQUE(connection_id, action_id)
) STRICT;

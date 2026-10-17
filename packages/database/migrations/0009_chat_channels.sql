ALTER TABLE chat_conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'WEB' CHECK(channel IN ('WEB','TELEGRAM'));
-- statement-breakpoint
ALTER TABLE chat_turns ADD COLUMN channel TEXT NOT NULL DEFAULT 'WEB' CHECK(channel IN ('WEB','TELEGRAM'));
-- statement-breakpoint
UPDATE chat_conversations SET channel = 'TELEGRAM'
WHERE EXISTS(SELECT 1 FROM telegram_conversations t WHERE t.conversation_id = chat_conversations.id
  AND t.org_id = chat_conversations.org_id AND t.user_id = chat_conversations.user_id);
-- statement-breakpoint
-- Channel attribution comes from server audit/events, never message text or client IDs.
UPDATE chat_turns SET channel = 'TELEGRAM' WHERE EXISTS(
  SELECT 1 FROM audit_events a WHERE a.org_id = chat_turns.org_id AND a.actor_id = chat_turns.user_id
    AND a.type = 'CHAT_TURN_COMPLETED' AND a.entity_id = chat_turns.id
    AND json_extract(a.details_json, '$.channel') = 'telegram') OR EXISTS(
  SELECT 1 FROM telegram_events e JOIN telegram_connections c ON c.id = e.connection_id
  WHERE e.operation_key = chat_turns.client_key AND c.org_id = chat_turns.org_id AND c.user_id = chat_turns.user_id);
-- statement-breakpoint
-- Recover web turns accidentally appended to a Telegram thread without rewriting their snapshots.
INSERT INTO chat_conversations(id,org_id,user_id,created_at,updated_at,channel)
SELECT 'chat_web_legacy_' || c.id,c.org_id,c.user_id,min(t.created_at),max(t.created_at),'WEB'
FROM chat_conversations c JOIN chat_turns t ON t.conversation_id = c.id AND t.org_id = c.org_id AND t.user_id = c.user_id
WHERE c.channel = 'TELEGRAM' AND t.channel = 'WEB' GROUP BY c.id,c.org_id,c.user_id;
-- statement-breakpoint
CREATE TABLE chat_turn_placements (
  turn_id TEXT PRIMARY KEY NOT NULL REFERENCES chat_turns(id),
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  FOREIGN KEY(org_id,user_id,conversation_id) REFERENCES chat_conversations(org_id,user_id,id)
) STRICT;
-- statement-breakpoint
INSERT INTO chat_turn_placements(turn_id,org_id,user_id,conversation_id)
SELECT t.id,t.org_id,t.user_id,'chat_web_legacy_' || c.id FROM chat_turns t
JOIN chat_conversations c ON c.id = t.conversation_id AND c.org_id = t.org_id AND c.user_id = t.user_id
WHERE c.channel = 'TELEGRAM' AND t.channel = 'WEB';
-- statement-breakpoint
CREATE VIEW chat_channel_turns AS SELECT t.*,t.rowid AS history_order,coalesce(p.conversation_id,t.conversation_id) AS history_conversation_id
FROM chat_turns t LEFT JOIN chat_turn_placements p ON p.turn_id = t.id AND p.org_id = t.org_id AND p.user_id = t.user_id;
-- statement-breakpoint
CREATE INDEX chat_conversations_channel ON chat_conversations(org_id,user_id,channel,updated_at);
-- statement-breakpoint
CREATE TRIGGER chat_turn_placement_no_update BEFORE UPDATE ON chat_turn_placements BEGIN SELECT RAISE(ABORT,'CHAT_HISTORY_IMMUTABLE'); END;
-- statement-breakpoint
CREATE TRIGGER chat_turn_placement_no_delete BEFORE DELETE ON chat_turn_placements BEGIN SELECT RAISE(ABORT,'CHAT_HISTORY_IMMUTABLE'); END;
-- statement-breakpoint
CREATE TRIGGER chat_conversation_channel_immutable BEFORE UPDATE OF channel ON chat_conversations BEGIN SELECT RAISE(ABORT,'CHAT_CHANNEL_IMMUTABLE'); END;
-- statement-breakpoint
CREATE TRIGGER chat_turn_channel_immutable BEFORE UPDATE OF channel ON chat_turns BEGIN SELECT RAISE(ABORT,'CHAT_CHANNEL_IMMUTABLE'); END;
-- statement-breakpoint
CREATE TRIGGER chat_turn_channel_matches BEFORE INSERT ON chat_turns BEGIN
  SELECT RAISE(ABORT,'CHAT_CHANNEL_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM chat_conversations c
    WHERE c.id = NEW.conversation_id AND c.org_id = NEW.org_id AND c.user_id = NEW.user_id AND c.channel = NEW.channel);
END;
-- statement-breakpoint
CREATE TRIGGER telegram_conversation_channel_matches BEFORE INSERT ON telegram_conversations BEGIN
  SELECT RAISE(ABORT,'CHAT_CHANNEL_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM chat_conversations c
    WHERE c.id = NEW.conversation_id AND c.org_id = NEW.org_id AND c.user_id = NEW.user_id AND c.channel = 'TELEGRAM');
END;

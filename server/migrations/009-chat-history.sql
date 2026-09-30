CREATE TABLE chat_messages (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  payload JSONB NOT NULL,
  role TEXT GENERATED ALWAYS AS (
    CASE payload->>'role' WHEN 'user' THEN 'u' WHEN 'assistant' THEN 'a' ELSE 's' END
  ) STORED,
  PRIMARY KEY (chat_id, position)
);
CREATE INDEX chat_messages_outline ON chat_messages(chat_id, position) INCLUDE (role);

INSERT INTO chat_messages(chat_id, position, payload)
SELECT c.id, (m.ordinality - 1)::integer, m.payload
FROM chats c
CROSS JOIN LATERAL jsonb_array_elements(c.messages::jsonb)
  WITH ORDINALITY AS m(payload, ordinality);

CREATE FUNCTION sync_chat_messages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM chat_messages
  WHERE chat_id = NEW.id AND position >= jsonb_array_length(NEW.messages::jsonb);

  INSERT INTO chat_messages(chat_id, position, payload)
  SELECT NEW.id, (m.ordinality - 1)::integer, m.payload
  FROM jsonb_array_elements(NEW.messages::jsonb)
    WITH ORDINALITY AS m(payload, ordinality)
  ON CONFLICT (chat_id, position) DO UPDATE SET payload = EXCLUDED.payload
  WHERE chat_messages.payload IS DISTINCT FROM EXCLUDED.payload;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chats_message_history
AFTER INSERT OR UPDATE OF messages ON chats
FOR EACH ROW EXECUTE FUNCTION sync_chat_messages();

-- 0.14: pinned message and forwarding. A forwarded attachment keeps its single files row,
-- which messages in other chats may reference; the row lives while any message uses it.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from text;

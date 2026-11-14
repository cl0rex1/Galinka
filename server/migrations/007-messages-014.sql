-- 0.14.0 messaging features:
-- delete for me/everyone + undo, scheduled messages/reminders, link previews,
-- expanded emoji reactions, edit history, polls, auto-delete timers, synced drafts.

ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_emoji_check;
ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_emoji_len;
ALTER TABLE reactions ADD CONSTRAINT reactions_emoji_len CHECK (char_length(emoji) BETWEEN 1 AND 16);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_deleted_at ON messages(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS hidden_messages (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS hidden_messages_user ON hidden_messages(user_id, message_id);

CREATE TABLE IF NOT EXISTS message_edits (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_body text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS message_edits_msg ON message_edits(message_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  silent boolean NOT NULL DEFAULT false,
  is_reminder boolean NOT NULL DEFAULT false,
  scheduled_for timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS scheduled_messages_due ON scheduled_messages(scheduled_for);
CREATE INDEX IF NOT EXISTS scheduled_messages_chat ON scheduled_messages(chat_id, sender_id, scheduled_for);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview jsonb;
CREATE TABLE IF NOT EXISTS link_previews (
  url text PRIMARY KEY,
  preview jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL,
  multiple boolean NOT NULL DEFAULT false,
  anonymous boolean NOT NULL DEFAULT false,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_index integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (poll_id, option_index, user_id)
);
CREATE INDEX IF NOT EXISTS poll_votes_poll ON poll_votes(poll_id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_id uuid REFERENCES polls(id) ON DELETE SET NULL;

ALTER TABLE chats ADD COLUMN IF NOT EXISTS auto_delete_seconds integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE members ADD COLUMN IF NOT EXISTS draft text NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;

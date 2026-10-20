CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL,
 password text NOT NULL, color integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS chats (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('direct','group','saved')),
 title text NOT NULL, owner_id uuid NOT NULL REFERENCES users(id), direct_key text UNIQUE,
 nelya boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
 chat_id uuid REFERENCES chats(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS files (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, size integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
 sender_id uuid REFERENCES users(id), body text NOT NULL DEFAULT '',
 file_id uuid REFERENCES files(id), nonce uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(sender_id,nonce)
);
CREATE INDEX IF NOT EXISTS messages_chat_time ON messages(chat_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS reactions (
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(emoji IN ('❤','👍','😂','🔥')), PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS invites (
 token text PRIMARY KEY, chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

ALTER TABLE messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();

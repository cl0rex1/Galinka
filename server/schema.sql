CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL,
 password text NOT NULL, color integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS announcements (
 id uuid PRIMARY KEY, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 published boolean NOT NULL DEFAULT false,
 author_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_published ON announcements(updated_at DESC,id DESC) WHERE published;
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
ALTER TABLE members ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS receipt_at timestamptz;
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
ALTER TABLE files ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
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

CREATE TABLE IF NOT EXISTS push_devices (
 token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_token text NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id);
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
 endpoint text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_token text NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
 p256dh text NOT NULL, auth text NOT NULL, expires_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user ON web_push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_expiry ON web_push_subscriptions(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS push_jobs (
 message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now()
);
-- A retry only sends to destinations that have not already accepted this message.
-- Deleting the job also removes its short-lived delivery receipts.
CREATE TABLE IF NOT EXISTS push_deliveries (
 message_id uuid REFERENCES push_jobs(message_id) ON DELETE CASCADE,
 transport text NOT NULL CHECK(transport IN ('android','browser')),
 destination text NOT NULL,
 PRIMARY KEY(message_id,transport,destination)
);

-- Marks AAC/MP4 files validated by the audio normalization pipeline. Legacy originals remain untouched.
ALTER TABLE files ADD COLUMN IF NOT EXISTS audio_ready boolean NOT NULL DEFAULT false;

-- 0.6: device list, sliding sessions and one-time sign-up invites.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS messages_file ON messages(file_id) WHERE file_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS signup_invites (
 token text PRIMARY KEY, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, used_by uuid REFERENCES users(id) ON DELETE SET NULL,
 used_at timestamptz
);

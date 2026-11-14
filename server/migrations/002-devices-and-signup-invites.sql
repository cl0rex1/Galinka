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

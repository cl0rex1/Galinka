-- 0.12: presence, privacy, notification previews and avatars.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_last_seen boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS group_invites text NOT NULL DEFAULT 'all';
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_preview text NOT NULL DEFAULT 'full';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar text;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_group_invites CHECK (group_invites IN ('all','nobody'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_notify_preview CHECK (notify_preview IN ('full','sender','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

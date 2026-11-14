-- 0.15.0: who may mention you, @все, notifications per chat kind, per-chat sound, quiet hours.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_direct boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_groups boolean NOT NULL DEFAULT true;
-- all: anyone in a shared group; known: only people you have a personal chat with; none: nobody.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mention_policy text NOT NULL DEFAULT 'all';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_mention_policy;
ALTER TABLE users ADD CONSTRAINT users_mention_policy CHECK (mention_policy IN ('all', 'known', 'none'));
-- Minutes after local midnight; the window may cross midnight (22:00–08:00).
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_from smallint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_to smallint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_quiet_hours;
ALTER TABLE users ADD CONSTRAINT users_quiet_hours CHECK (
  (quiet_from IS NULL AND quiet_to IS NULL)
  OR (quiet_from BETWEEN 0 AND 1439 AND quiet_to BETWEEN 0 AND 1439)
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS sound text NOT NULL DEFAULT 'default';
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_sound;
ALTER TABLE members ADD CONSTRAINT members_sound CHECK (sound IN ('default', 'soft', 'bright', 'silent'));

-- Set when the group owner wrote @все within the rate limit: it mentions every member.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mention_all boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS messages_mention_all ON messages(chat_id, created_at) WHERE mention_all;

-- One rule for the chat list badge, the "@" button, pushes and desktop notifications.
CREATE OR REPLACE FUNCTION mentions_user(body text, mention_all boolean, sender uuid, recipient uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT sender IS DISTINCT FROM recipient AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = recipient
      AND (mention_all OR body ~* ('(^|[^[:alnum:]_@])@' || u.username || '($|[^[:alnum:]_])'))
      AND CASE u.mention_policy
        WHEN 'none' THEN false
        WHEN 'known' THEN EXISTS (
          SELECT 1 FROM chats c
          JOIN members a ON a.chat_id = c.id AND a.user_id = recipient
          JOIN members b ON b.chat_id = c.id AND b.user_id = sender
          WHERE c.kind = 'direct')
        ELSE true
      END)
$$;

CREATE OR REPLACE FUNCTION in_quiet_hours(quiet_from smallint, quiet_to smallint, zone text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN quiet_from IS NULL OR quiet_to IS NULL OR quiet_from = quiet_to THEN false
    ELSE (
      SELECT CASE WHEN quiet_from < quiet_to THEN minute >= quiet_from AND minute < quiet_to
                  ELSE minute >= quiet_from OR minute < quiet_to END
      FROM (SELECT (extract(hour FROM now() AT TIME ZONE zone) * 60
                    + extract(minute FROM now() AT TIME ZONE zone))::int AS minute) local_time)
  END
$$;

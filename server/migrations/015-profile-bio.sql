-- A short line about yourself, shown in your profile (Telegram's "bio").
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 140);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

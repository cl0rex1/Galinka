-- 0.16.0: what the feed needs before a picture loads, the voice waveform, resumable uploads and
-- background video conversion.
ALTER TABLE files ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE files ADD COLUMN IF NOT EXISTS height integer;
-- A tiny blurred JPEG/WebP data URL drawn while the real picture loads.
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumb text;
-- Voice loudness, 48 bars of 0..31.
ALTER TABLE files ADD COLUMN IF NOT EXISTS waveform smallint[];

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  width integer,
  height integer,
  thumb text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_user ON uploads(user_id);

-- Videos converted after sending: WebM (Firefox) to MP4 for Safari, big videos made smaller.
CREATE TABLE IF NOT EXISTS media_jobs (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

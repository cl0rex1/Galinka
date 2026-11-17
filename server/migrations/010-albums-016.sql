-- 0.16.0: several photos or videos sent at once share an album id; the app draws them as one grid.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS album_id uuid;
CREATE INDEX IF NOT EXISTS messages_album ON messages(album_id) WHERE album_id IS NOT NULL;

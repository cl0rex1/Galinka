CREATE TABLE voice_transcripts (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'ready', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  transcript text,
  CHECK ((state = 'ready') = (transcript IS NOT NULL))
);
CREATE INDEX voice_transcripts_queue ON voice_transcripts(updated_at) WHERE state IN ('pending', 'running');

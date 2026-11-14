CREATE TABLE IF NOT EXISTS client_errors (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  message text NOT NULL,
  stack text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  release text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_errors_created ON client_errors(created_at DESC);

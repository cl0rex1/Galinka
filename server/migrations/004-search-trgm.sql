-- 0.13: trigram index for message search (ILIKE '%text%'; strpos/lower cannot use it).
-- The operator class is qualified with the extension's schema, which may be off search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$ BEGIN
  EXECUTE format('CREATE INDEX IF NOT EXISTS messages_body_trgm ON messages USING gin (body %I.gin_trgm_ops)',
    (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'));
END $$;

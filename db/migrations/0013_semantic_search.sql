-- Semantic search (pgvector). The extension itself must be created out-of-band
-- by a superuser (same pattern as pgroonga): CREATE EXTENSION vector;
-- When the extension is missing this migration records a NOTICE and skips the
-- DDL instead of failing the deploy; scripts/embed-backfill.ts re-ensures the
-- table afterwards (ensureSemanticSchema), so a late install is harmless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS concept_embeddings (
      concept_id   uuid PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
      owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash text NOT NULL,           -- body hash the vector was computed from
      model        text NOT NULL,           -- embedding model name; model changes re-embed
      embedding    vector NOT NULL,         -- dimension pinned on first backfill
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON concept_embeddings (owner_id);
  ELSE
    RAISE NOTICE 'pgvector not installed; concept_embeddings skipped (install extension, then run npm run db:embed-backfill)';
  END IF;
END $$;

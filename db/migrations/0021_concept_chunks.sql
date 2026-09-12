-- Full-document semantic recall. The legacy concept_embeddings table remains
-- as one compatibility/statistics vector per concept; all live semantic
-- retrieval reads the finer-grained rows below.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS concept_embedding_chunks (
      concept_id           uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      chunk_ordinal        integer NOT NULL,
      owner_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash         text NOT NULL,
      source_title         text NOT NULL,
      source_description   text,
      embedding_endpoint   text NOT NULL,
      model                text NOT NULL,
      dimensions           integer NOT NULL CHECK (dimensions > 0),
      start_offset         integer NOT NULL CHECK (start_offset >= 0),
      end_offset           integer NOT NULL CHECK (end_offset >= start_offset),
      chunk_text           text NOT NULL,
      embedding            vector NOT NULL,
      created_at           timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (concept_id, chunk_ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_embedding_chunks_owner_model
      ON concept_embedding_chunks (owner_id, embedding_endpoint, model, dimensions);
  ELSE
    RAISE NOTICE 'pgvector not installed; concept_embedding_chunks skipped (install extension, then run npm run db:embed-backfill)';
  END IF;
END $$;

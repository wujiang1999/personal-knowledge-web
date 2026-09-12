-- Search improvements (A-tier):
-- 1. Weighted tsvector: title carries weight A, description/body weight B, so
--    ts_rank can favor title hits (weights are passed at query time).
-- 2. Rebuild existing tsvectors under the new function.
-- 3. Owner-scoped pagination index for the concept list.
-- 2026-09-12: the baseline no longer creates content_tsv (BM25 replaced
-- tsquery scoring; 0020 drops the whole tsvector pipeline), so the tsv setup
-- below only runs on databases that still carry the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'concept_versions'::regclass AND attname = 'content_tsv'
  ) THEN
    CREATE OR REPLACE FUNCTION concept_versions_tsv_trigger() RETURNS trigger AS $fn$
    BEGIN
      NEW.content_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.body_markdown, '')), 'B');
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_concept_versions_tsv ON concept_versions;
    CREATE TRIGGER trg_concept_versions_tsv
      BEFORE INSERT OR UPDATE OF body_markdown ON concept_versions
      FOR EACH ROW EXECUTE FUNCTION concept_versions_tsv_trigger();
    UPDATE concept_versions SET body_markdown = body_markdown;
  ELSE
    RAISE NOTICE 'content_tsv absent; skipping tsvector trigger setup';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_concepts_owner_updated ON concepts (owner_id, updated_at DESC);

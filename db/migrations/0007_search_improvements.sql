-- Search improvements (A-tier):
-- 1. Weighted tsvector: title carries weight A, description/body weight B, so
--    ts_rank can favor title hits (weights are passed at query time).
-- 2. Rebuild existing tsvectors under the new function.
-- 3. Owner-scoped pagination index for the concept list.
CREATE OR REPLACE FUNCTION concept_versions_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.body_markdown, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concept_versions_tsv ON concept_versions;
CREATE TRIGGER trg_concept_versions_tsv
  BEFORE INSERT OR UPDATE OF body_markdown ON concept_versions
  FOR EACH ROW EXECUTE FUNCTION concept_versions_tsv_trigger();

-- Rebuild existing rows (the trigger fires on UPDATE OF body_markdown).
UPDATE concept_versions SET body_markdown = body_markdown;

CREATE INDEX IF NOT EXISTS idx_concepts_owner_updated ON concepts (owner_id, updated_at DESC);

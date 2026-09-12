-- PGroonga CJK-aware full-text search (B-tier). Requires the extension to be
-- created out-of-band by a superuser BEFORE this migration runs:
--
--   CREATE EXTENSION IF NOT EXISTS pgroonga;
--
-- Package: postgresql-16-pgroonga from https://packages.groonga.org/ubuntu/
-- 2026-09-12: BM25 scoring no longer reads these indexes (0020 drops them);
-- guard the DDL on the extension so fresh installs without the package
-- still migrate cleanly (same pattern as 0013 for pgvector).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgroonga') THEN
    CREATE INDEX IF NOT EXISTS idx_versions_body_pgroonga ON concept_versions USING pgroonga (body_markdown);
    CREATE INDEX IF NOT EXISTS idx_concepts_title_pgroonga ON concepts USING pgroonga (title);
  ELSE
    RAISE NOTICE 'pgroonga not installed; pgroonga indexes skipped';
  END IF;
END $$;

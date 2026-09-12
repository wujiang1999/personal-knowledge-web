-- Dead search-index cleanup. The 2026-09-04 retrieval rework (8d988ae) moved
-- scoring to plain-SQL BM25 and removed every pgroonga/tsquery code path, but
-- left the indexes in place ("DB 内 pgroonga/trgm/tsv 索引保留未删"). Since
-- then they have zero code references while every version write still pays
-- their maintenance (two Groonga inverted indexes + the tsvector trigger).
-- The pg_trgm indexes stay: the typo fallback still uses similarity().
DROP INDEX IF EXISTS idx_versions_body_pgroonga;
DROP INDEX IF EXISTS idx_concepts_title_pgroonga;
DROP INDEX IF EXISTS idx_versions_tsv;
DROP TRIGGER IF EXISTS trg_concept_versions_tsv ON concept_versions;
DROP FUNCTION IF EXISTS concept_versions_tsv_trigger();
ALTER TABLE concept_versions DROP COLUMN IF EXISTS content_tsv;

-- PGroonga CJK-aware full-text search (B-tier). Requires the extension to be
-- created out-of-band by a superuser BEFORE this migration runs:
--
--   CREATE EXTENSION IF NOT EXISTS pgroonga;
--
-- Package: postgresql-16-pgroonga from https://packages.groonga.org/ubuntu/
CREATE INDEX IF NOT EXISTS idx_versions_body_pgroonga ON concept_versions USING pgroonga (body_markdown);
CREATE INDEX IF NOT EXISTS idx_concepts_title_pgroonga ON concepts USING pgroonga (title);

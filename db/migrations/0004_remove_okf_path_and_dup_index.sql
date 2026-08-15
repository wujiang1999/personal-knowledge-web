-- Workstream C3/C4: okf_path is dead (never written); idx_versions_concept is
-- redundant with UNIQUE(concept_id, version_number).
ALTER TABLE concepts DROP COLUMN IF EXISTS okf_path;
DROP INDEX IF EXISTS idx_versions_concept;

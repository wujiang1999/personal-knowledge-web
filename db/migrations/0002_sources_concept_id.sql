-- Workstream C2: link source rows back to the concept they were recorded for.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS concept_id uuid REFERENCES concepts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sources_concept_id ON sources (concept_id);

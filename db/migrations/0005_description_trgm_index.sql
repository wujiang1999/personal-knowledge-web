-- Workstream B1: make description ILIKE/similarity index-assisted.
CREATE INDEX IF NOT EXISTS idx_concepts_desc_trgm ON concepts USING GIN (description gin_trgm_ops);

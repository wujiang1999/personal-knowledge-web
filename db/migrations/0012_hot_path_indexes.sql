-- addConceptVersion probes sources for an existing identical body on every
-- version save (WHERE content_hash = $1 AND concept_id = $2); without an
-- index that probe seq-scans sources each time, growing with history.
CREATE INDEX IF NOT EXISTS idx_sources_hash_concept ON sources (content_hash, concept_id);

-- Folder operations and tree building filter concepts by owner + exact
-- category; a btree on (owner_id, category) serves those equality probes.
CREATE INDEX IF NOT EXISTS idx_concepts_owner_category ON concepts (owner_id, category);

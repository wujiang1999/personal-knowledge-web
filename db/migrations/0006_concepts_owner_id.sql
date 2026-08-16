-- Workstream (isolation): every concept belongs to one user. Existing rows are
-- backfilled to the admin account, then the column is made NOT NULL.
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

UPDATE concepts
SET owner_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
WHERE owner_id IS NULL;

ALTER TABLE concepts ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concepts_owner_id ON concepts (owner_id);

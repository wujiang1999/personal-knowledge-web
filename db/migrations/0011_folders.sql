-- Empty-folder support: folders are otherwise derived views over
-- concepts.category, which cannot exist without entries. Rows here are the
-- entity form of a folder; the visible tree is the union of this table and
-- concept-derived paths (buildCategoryTree). owner scoping mirrors concepts.
CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_owner_path ON folders (owner_id, path);

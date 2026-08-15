-- Workstream C1: snapshot concept metadata onto each version row so past
-- versions are reconstructable without joining current concept state.
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE concept_versions ADD COLUMN IF NOT EXISTS type text;

-- Backfill existing rows from current concept state (best available source).
-- Guarded on v.title IS NULL so a re-run never overwrites a real snapshot.
UPDATE concept_versions v
SET title = c.title,
    description = c.description,
    category = c.category,
    tags = c.tags,
    status = c.status,
    type = c.type
FROM concepts c
WHERE c.id = v.concept_id
  AND v.title IS NULL;

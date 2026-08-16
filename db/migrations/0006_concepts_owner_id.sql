-- Workstream (isolation): every concept belongs to one user. Existing rows are
-- backfilled (admin first, then any user as a fallback), then the column is made
-- NOT NULL.
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Backfill with a fallback chain instead of hardcoding 'admin':
-- a deployment seeded with a custom ADMIN_USERNAME would otherwise backfill to
-- NULL and make the SET NOT NULL below fail, blocking the upgrade.
DO $$
DECLARE
  fallback_uuid uuid;
BEGIN
  SELECT COALESCE(
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
  ) INTO fallback_uuid;

  IF EXISTS (SELECT 1 FROM concepts WHERE owner_id IS NULL) AND fallback_uuid IS NULL THEN
    RAISE EXCEPTION 'concepts exist but no user row is available to backfill owner_id; create a user first (npm run db:seed / db:add-user)';
  END IF;

  UPDATE concepts SET owner_id = fallback_uuid WHERE owner_id IS NULL;
END $$;

ALTER TABLE concepts ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concepts_owner_id ON concepts (owner_id);
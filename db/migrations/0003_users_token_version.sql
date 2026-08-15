-- Workstream A3: per-user session generation counter; bumping it invalidates
-- all previously issued JWTs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;

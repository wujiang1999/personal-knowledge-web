-- personal-knowledge-web schema (single-workspace MVP)
-- Apply with: npm run db:migrate  (or psql -f db/schema.sql)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------
-- users (single-user / invite model)
-- -------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- concepts (current state)
-- -------------------------------
CREATE TABLE IF NOT EXISTS concepts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okf_path        text,
  type            text NOT NULL,
  title           text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'stable',   -- draft | stable | deprecated
  tags            text[] NOT NULL DEFAULT '{}',
  current_version integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- concept_versions (immutable history)
-- -------------------------------
CREATE TABLE IF NOT EXISTS concept_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id     uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  body_markdown  text NOT NULL,
  content_tsv    tsvector,
  content_hash   text NOT NULL,
  generated_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, version_number)
);

-- -------------------------------
-- sources (raw input traceability)
-- -------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   text NOT NULL,       -- text | markdown
  original_name text,
  content       text,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- indexes
-- -------------------------------
CREATE INDEX IF NOT EXISTS idx_concepts_title        ON concepts (title);
CREATE INDEX IF NOT EXISTS idx_concepts_status       ON concepts (status);
CREATE INDEX IF NOT EXISTS idx_versions_concept      ON concept_versions (concept_id);
CREATE INDEX IF NOT EXISTS idx_versions_tsv          ON concept_versions USING GIN (content_tsv);
CREATE INDEX IF NOT EXISTS idx_versions_body_trgm    ON concept_versions USING GIN (body_markdown gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_concepts_title_trgm   ON concepts USING GIN (title gin_trgm_ops);

-- -------------------------------
-- tsvector maintenance trigger
-- -------------------------------
CREATE OR REPLACE FUNCTION concept_versions_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', coalesce(NEW.body_markdown, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concept_versions_tsv ON concept_versions;
CREATE TRIGGER trg_concept_versions_tsv
  BEFORE INSERT OR UPDATE OF body_markdown ON concept_versions
  FOR EACH ROW EXECUTE FUNCTION concept_versions_tsv_trigger();
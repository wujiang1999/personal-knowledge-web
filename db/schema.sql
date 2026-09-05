-- personal-knowledge-web schema (single-workspace MVP)
-- Apply with: npm run db:migrate  (or psql -f db/schema.sql)
-- Fresh installs get the complete final shape here; existing databases are
-- brought up to date by the numbered files in db/migrations/.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CJK-aware full-text search; requires the postgresql-16-pgroonga package on
-- the deployment host (https://packages.groonga.org/ubuntu/).
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- -------------------------------
-- migration bookkeeping
-- -------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- users (single-user / invite model)
-- -------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 1,
  role          text NOT NULL DEFAULT 'user',  -- 'user' | 'admin'; admin bypasses owner scoping
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- concepts (current state)
-- -------------------------------
CREATE TABLE IF NOT EXISTS concepts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL,
  title           text NOT NULL,
  description     text,
  category        text,
  status          text NOT NULL DEFAULT 'stable',   -- draft | stable | deprecated
  tags            text[] NOT NULL DEFAULT '{}',
  current_version integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 回收站（软删除）：NULL = 在库；非 NULL = 已删除，仅回收站可见/可恢复。
  -- 默认可见面（列表/搜索/图谱/导出/链接网络）一律过滤 deleted_at IS NULL，
  -- 只有回收站中的「彻底删除」才真正 CASCADE 清除。
  deleted_at      timestamptz
);

-- -------------------------------
-- concept_versions (immutable history, with metadata snapshot)
-- -------------------------------
CREATE TABLE IF NOT EXISTS concept_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id     uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  title          text,
  description    text,
  category       text,
  tags           text[] NOT NULL DEFAULT '{}',
  status         text,
  type           text,
  body_markdown  text NOT NULL,
  content_tsv    tsvector,
  content_hash   text NOT NULL,
  generated_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, version_number)
);

-- -------------------------------
-- sources (raw input traceability, linked back to the concept)
-- -------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id    uuid REFERENCES concepts(id) ON DELETE SET NULL,
  source_type   text NOT NULL,       -- text | markdown
  original_name text,
  content       text,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- attachments (files uploaded under a concept; bytes live on local disk)
-- -------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id    uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  storage_key   text NOT NULL UNIQUE,   -- server-generated filename on disk
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,    -- sha256 of the plaintext key; the
                                        -- plaintext is shown once at creation
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- -------------------------------
-- usage logs (search queries + LLM/embedding calls, rendered on /logs)
-- -------------------------------
CREATE TABLE IF NOT EXISTS search_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query        text NOT NULL,
  source       text NOT NULL DEFAULT 'api',  -- ui | api | ingest (caller surface)
  mode         text NOT NULL,                -- bm25 | trgm-fallback | semantic-only
  result_count int NOT NULL,
  total        int NOT NULL,
  took_ms      int NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE, -- null = system/script call
  kind              text NOT NULL,               -- 'llm' | 'embedding'
  purpose           text NOT NULL,               -- auto-summary | search-embed | ingest-atomize | backfill | chat
  model             text NOT NULL,
  input_chars       int,
  prompt_tokens     int,
  completion_tokens int,                         -- embeddings have none
  took_ms           int,
  ok                boolean NOT NULL,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------
-- indexes
-- -------------------------------
CREATE INDEX IF NOT EXISTS idx_concepts_title      ON concepts (title);
CREATE INDEX IF NOT EXISTS idx_concepts_status     ON concepts (status);
CREATE INDEX IF NOT EXISTS idx_concepts_owner_updated ON concepts (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_concepts_title_trgm ON concepts USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_concepts_desc_trgm  ON concepts USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_versions_tsv        ON concept_versions USING GIN (content_tsv);
CREATE INDEX IF NOT EXISTS idx_versions_body_trgm  ON concept_versions USING GIN (body_markdown gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_versions_body_pgroonga ON concept_versions USING pgroonga (body_markdown);
CREATE INDEX IF NOT EXISTS idx_concepts_title_pgroonga ON concepts USING pgroonga (title);
-- idx_sources_concept_id is created by db/migrations/0002 (the column is
-- migration-added on existing databases; creating the index here would fail
-- before 0002 runs).
CREATE INDEX IF NOT EXISTS idx_attachments_concept_id ON attachments (concept_id);
-- Added by db/migrations/0012: dedup probe on version save + category tree ops.
CREATE INDEX IF NOT EXISTS idx_sources_hash_concept ON sources (content_hash, concept_id);
CREATE INDEX IF NOT EXISTS idx_concepts_owner_category ON concepts (owner_id, category);
-- Added by db/migrations/0014: usage logs (see the tables above).
CREATE INDEX IF NOT EXISTS idx_search_logs_time ON search_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_user_time ON search_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_time ON llm_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_time ON llm_calls (user_id, created_at DESC);
-- Added by db/migrations/0015: recycle-bin partial indexes (hot paths only
-- scan live rows; the trash listing scans its own small index).
CREATE INDEX IF NOT EXISTS idx_concepts_alive_owner_updated
  ON concepts (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_concepts_trash
  ON concepts (owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- -------------------------------
-- tsvector maintenance trigger
-- -------------------------------
CREATE OR REPLACE FUNCTION concept_versions_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.body_markdown, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concept_versions_tsv ON concept_versions;
CREATE TRIGGER trg_concept_versions_tsv
  BEFORE INSERT OR UPDATE OF body_markdown ON concept_versions
  FOR EACH ROW EXECUTE FUNCTION concept_versions_tsv_trigger();

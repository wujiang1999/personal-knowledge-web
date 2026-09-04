-- Usage logs (查询记录 + LLM/embedding 调用记录) rendered on /logs.
-- Writers live in lib/logs.ts and are fire-and-forget: every insert swallows
-- its own error, so a missing table degrades logging only — never the product.

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
CREATE INDEX IF NOT EXISTS idx_search_logs_time ON search_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_user_time ON search_logs (user_id, created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_llm_calls_time ON llm_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_time ON llm_calls (user_id, created_at DESC);

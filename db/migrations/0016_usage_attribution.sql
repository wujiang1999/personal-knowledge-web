-- Usage attribution & traffic observability (2026-09-05 ops-stats batch):
-- 1) search_logs / llm_calls gain api_key_id — per-key usage attribution for
--    the /stats console (which machine client called how much, at what
--    success rate). Nullable: cookie (browser) sessions have no key.
-- 2) concepts gain retrieval_count / last_retrieved_at — how often an entry
--    is actually returned by a search (ui|api sources only; ingest dedup
--    probes don't count, cache hits never reach the writer). Curation
--    signal: never-retrieved entries are archive candidates, hot entries
--    are crystallization candidates.
-- 3) request_log — one row per API request (route/status/latency), giving
--    /stats its traffic overview (totals, success rate, p50/p95) and the
--    per-key "knowledge contribution" (non-GET writes on /api/concepts*).
--    Writes are fire-and-forget from lib/withRoute; rows expire after 180
--    days via a probabilistic cleanup piggybacked on inserts.

ALTER TABLE search_logs
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;
ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_search_logs_key_time ON search_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_key_time   ON llm_calls (api_key_id, created_at DESC);

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS retrieval_count integer NOT NULL DEFAULT 0;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS last_retrieved_at timestamptz;
-- Partial index lives here only: it references deleted_at (added by 0015 on
-- existing databases), so base schema.sql must not create it (same rule as
-- the 0015 recycle-bin indexes).
CREATE INDEX IF NOT EXISTS idx_concepts_retrieval
  ON concepts (retrieval_count DESC) WHERE deleted_at IS NULL AND retrieval_count > 0;

CREATE TABLE IF NOT EXISTS request_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  route      text NOT NULL,  -- withRoute name, 'GET /api/search' shape
  method     text NOT NULL,
  path       text NOT NULL,
  status     int NOT NULL,
  took_ms    int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_log_time     ON request_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_key_time ON request_log (api_key_id, created_at DESC);

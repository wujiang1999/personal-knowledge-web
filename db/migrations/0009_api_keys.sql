-- API keys for machine clients (e.g. the personal-kb MCP server): revocable,
-- independently rotatable Bearer credentials that never touch the account
-- password. Keys are stored as SHA-256 hashes; the plaintext is shown once at
-- creation (scripts/create-api-key.ts) and authenticated via
-- `Authorization: Bearer pkb_...` in lib/apiKey.ts.
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);

-- Multi-account management (2026-09-06): admin user administration moves from
-- server-side CLI into the web console. Two columns:
-- 1) disabled_at — soft disable. NULL = active. A disabled account cannot log
--    in, its existing sessions die (token_version bump at disable time), and
--    every Bearer API key it owns is rejected (the key lookup joins users and
--    filters disabled). Enabling clears the column; the user logs in as fresh.
-- 2) last_login_at — stamped by the login route, so /users shows which
--    accounts are actually alive without touching llm/search logs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Role-based access: 'admin' accounts may read/act across all users' data
-- (owner_id filters are bypassed for them in lib/concepts.ts and the API
-- routes); 'user' accounts keep strict per-owner isolation. The initial
-- admin is the 'admin' account by name.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
UPDATE users SET role = 'admin' WHERE username = 'admin' AND role <> 'admin';

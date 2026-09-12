-- Per-key least-privilege scopes. Existing integrations used unrestricted
-- owner credentials, so retain their ability to work during migration by
-- explicitly assigning the conservative operational default: write.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'write';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE api_keys SET access_mode = 'write' WHERE access_mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'api_keys_access_mode_check'
      AND conrelid = 'api_keys'::regclass
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_access_mode_check
      CHECK (access_mode IN ('read', 'write', 'admin'));
  END IF;
END $$;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ghl_access_token      TEXT,
  ADD COLUMN IF NOT EXISTS ghl_refresh_token     TEXT,
  ADD COLUMN IF NOT EXISTS ghl_token_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_connect_status    TEXT DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS ghl_connected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_company_id        TEXT;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_ghl_connect_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_ghl_connect_status_check
  CHECK (ghl_connect_status IS NULL OR ghl_connect_status IN ('not_connected','onboarding','connected','disabled'));;

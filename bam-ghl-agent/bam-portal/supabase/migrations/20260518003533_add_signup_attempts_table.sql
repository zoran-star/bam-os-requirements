-- Tracks public signup attempts for IP rate limiting + abuse forensics.
-- Each POST to /api/clients (public signup path) logs one row regardless of outcome.
CREATE TABLE IF NOT EXISTS signup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  email text,
  succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_attempts_ip_attempted_at_idx
  ON signup_attempts(ip, attempted_at DESC);
CREATE INDEX IF NOT EXISTS signup_attempts_attempted_at_idx
  ON signup_attempts(attempted_at DESC);

-- No RLS — only the service key writes to this table.
ALTER TABLE signup_attempts ENABLE ROW LEVEL SECURITY;;

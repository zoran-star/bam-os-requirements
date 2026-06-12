-- Track what TYPE of public auth attempt this was (signup vs reset).
-- Lets us rate-limit each independently while sharing one table.
ALTER TABLE signup_attempts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'signup'
    CHECK (kind IN ('signup', 'password_reset'));

CREATE INDEX IF NOT EXISTS signup_attempts_kind_ip_attempted_at_idx
  ON signup_attempts(kind, ip, attempted_at DESC);;

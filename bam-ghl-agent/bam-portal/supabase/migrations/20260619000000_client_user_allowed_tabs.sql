-- Per-staff tab permissions (client portal). The academy owner picks which tabs
-- each teammate can see. NULL = all tabs (default — existing staff unaffected).
-- Stores logical tab keys (e.g. ["marketing","members","contacts"]); the owner
-- role is never restricted. Enforcement is a SUBTRACTIVE filter on top of the
-- tier (V1/V1.5/V2) nav gating in client-portal.html.
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS allowed_tabs jsonb;

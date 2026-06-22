-- Per-staff KPI category permissions (client portal). The academy owner picks
-- which KPI dashboard sections (marketing/sales/revenue/members) each teammate
-- can see. NULL = all categories (default). Subtractive, like allowed_tabs /
-- allowed_stages; owner never restricted.
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS allowed_kpis jsonb;

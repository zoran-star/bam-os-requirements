-- Per-staff pipeline STAGE permissions (client portal). The academy owner picks
-- which pipeline stages (columns) each teammate can see in the Sales/Pipelines
-- board. NULL = all stages (default). Stores GHL stage ids; owner never
-- restricted. Subtractive, like allowed_tabs.
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS allowed_stages jsonb;

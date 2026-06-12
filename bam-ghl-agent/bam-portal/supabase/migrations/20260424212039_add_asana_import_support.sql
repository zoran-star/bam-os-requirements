
-- Add columns to tickets for Asana import
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asana_gid text;

-- Unique index (partial — only enforce when asana_gid is set)
CREATE UNIQUE INDEX IF NOT EXISTS tickets_asana_gid_unique
  ON tickets (asana_gid) WHERE asana_gid IS NOT NULL;

-- Check constraints
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_check
  CHECK (category IS NULL OR category IN ('systems','website','ads','other'));

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_source_check
  CHECK (source IN ('portal','asana_import'));

-- Academy mapping table (exact-match Asana name → client_id)
CREATE TABLE IF NOT EXISTS academy_mappings (
  asana_name text PRIMARY KEY,
  client_id  uuid REFERENCES clients(id) ON DELETE CASCADE,
  -- null client_id means "skip — not a real client" (e.g. BAM Business, Biz, Coaches)
  skip       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff(id)
);

ALTER TABLE academy_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academy_mappings_staff_read ON academy_mappings;
CREATE POLICY academy_mappings_staff_read ON academy_mappings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid()));

DROP POLICY IF EXISTS academy_mappings_staff_write ON academy_mappings;
CREATE POLICY academy_mappings_staff_write ON academy_mappings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid()));
;

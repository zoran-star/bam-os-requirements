-- ─────────────────────────────────────────────────────────────────────────
-- Schema migration: Notion → Supabase clients consolidation
-- Date: 2026-05-17
-- Run order: this SQL, then `node scripts/migration/backfill-clients.mjs --apply`
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Rename clients.name → clients.business_name
ALTER TABLE clients RENAME COLUMN name TO business_name;

-- 2. Add scaling_manager_id FK referencing staff
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS scaling_manager_id uuid REFERENCES staff(id) ON DELETE SET NULL;

-- 3. Helpful index for filtering clients by scaling manager
CREATE INDEX IF NOT EXISTS clients_scaling_manager_id_idx
  ON clients(scaling_manager_id);

-- ── Verification queries (run after the ALTERs) ──
-- Should return business_name (not name)
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'clients' AND column_name IN ('name', 'business_name');
-- Should return scaling_manager_id
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'clients' AND column_name = 'scaling_manager_id';

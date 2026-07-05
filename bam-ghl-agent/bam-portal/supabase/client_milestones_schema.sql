-- Client milestones & personal records
-- Tracks tier milestones (rev_day_1000, members_100) and personal bests (record_rev_day)
-- Run this in Supabase SQL Editor before or at deploy time.
-- Applied to production 2026-07-05.

CREATE TABLE IF NOT EXISTS client_milestones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,               -- clients.id (UUID as text; the portal sends CLIENT_ID = clients.id)
  key TEXT NOT NULL,                     -- e.g. "rev_day_5000", "record_rev_day"
  value NUMERIC,                         -- the numeric value (record amount, or tier threshold)
  achieved_at TIMESTAMPTZ DEFAULT now(), -- when this milestone was first hit (or record beaten)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, key)
);

CREATE INDEX IF NOT EXISTS idx_client_milestones_client ON client_milestones(client_id);

ALTER TABLE client_milestones ENABLE ROW LEVEL SECURITY;

-- Scope to the caller's own academies (or staff), matching every other
-- client-scoped table in this DB. client_id is TEXT holding a clients.id UUID,
-- so cast my_client_ids() (SETOF uuid) to text for the comparison.
-- NOTE: the /api/milestones route also enforces ownership at the app layer
-- (resolveUser + academy check); these policies are the defense-in-depth backstop.
CREATE POLICY "client_milestones_select" ON client_milestones
  FOR SELECT USING (is_staff() OR (client_id IN (SELECT my_client_ids()::text)));

CREATE POLICY "client_milestones_insert" ON client_milestones
  FOR INSERT WITH CHECK (is_staff() OR (client_id IN (SELECT my_client_ids()::text)));

CREATE POLICY "client_milestones_update" ON client_milestones
  FOR UPDATE USING (is_staff() OR (client_id IN (SELECT my_client_ids()::text)))
  WITH CHECK (is_staff() OR (client_id IN (SELECT my_client_ids()::text)));

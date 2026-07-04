-- Client milestones & personal records
-- Tracks tier milestones (rev_day_1000, members_100) and personal bests (record_rev_day)
-- Run this in Supabase SQL Editor before or at deploy time

CREATE TABLE IF NOT EXISTS client_milestones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,              -- ghl_location_id from clients table
  key TEXT NOT NULL,                     -- e.g. "rev_day_5000", "record_rev_day"
  value NUMERIC,                         -- the numeric value (record amount, or tier threshold)
  achieved_at TIMESTAMPTZ DEFAULT now(), -- when this milestone was first hit (or record beaten)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, key)
);

CREATE INDEX IF NOT EXISTS idx_client_milestones_client ON client_milestones(client_id);

ALTER TABLE client_milestones ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read milestones
CREATE POLICY "Authenticated can read milestones" ON client_milestones
  FOR SELECT USING (auth.role() = 'authenticated');

-- Authenticated users can insert milestones
CREATE POLICY "Authenticated can insert milestones" ON client_milestones
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Authenticated users can update milestones (for record upserts)
CREATE POLICY "Authenticated can update milestones" ON client_milestones
  FOR UPDATE USING (auth.role() = 'authenticated');

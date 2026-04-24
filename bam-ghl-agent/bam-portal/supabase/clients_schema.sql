-- BAM clients table — one row per GHL sub-account (academy)
-- Run this in Supabase SQL Editor or via migration

CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding', 'active', 'paused', 'churned')),
  ghl_location_id TEXT UNIQUE,
  slack_channel_id TEXT,
  stripe_customer_id TEXT,
  notion_page_id TEXT,
  asana_project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Staff (any authenticated user) can read all clients
CREATE POLICY "Staff can read clients" ON clients
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff can insert clients
CREATE POLICY "Staff can insert clients" ON clients
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Staff can update clients
CREATE POLICY "Staff can update clients" ON clients
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_clients_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_clients_updated_at();

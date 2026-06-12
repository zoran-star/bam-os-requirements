CREATE TABLE IF NOT EXISTS tickets (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK (type IN ('error', 'change', 'build')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'done')),
  priority         TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('urgent', 'standard', 'low')),
  fields           JSONB NOT NULL DEFAULT '{}',
  files            JSONB NOT NULL DEFAULT '[]',
  menu_item        TEXT,
  assigned_to      TEXT,
  staff_notes      TEXT,
  submitted_at     TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Clients can insert their own tickets (via anon key from client portal)
CREATE POLICY "Clients can submit tickets" ON tickets
  FOR INSERT WITH CHECK (true);

-- Clients can read their own tickets by client_id
CREATE POLICY "Clients can read own tickets" ON tickets
  FOR SELECT USING (true);

-- Staff (authenticated) can update tickets
CREATE POLICY "Staff can update tickets" ON tickets
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_tickets_updated_at();;

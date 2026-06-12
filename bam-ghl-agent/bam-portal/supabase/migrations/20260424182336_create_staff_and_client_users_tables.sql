-- Staff table (BAM internal team)
CREATE TABLE IF NOT EXISTS staff (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'systems', 'marketing', 'sm', 'staff')),
  slack_user_id   TEXT,
  slack_token     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read all staff" ON staff
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can update own row" ON staff
  FOR UPDATE USING (auth.uid() = user_id);

-- Client users table (academy owners for now)
CREATE TABLE IF NOT EXISTS client_users (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read own row" ON client_users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Staff can read all client users" ON client_users
  FOR SELECT USING (auth.role() = 'authenticated');

-- Add submitted_by to tickets
ALTER TABLE tickets ADD COLUMN submitted_by UUID REFERENCES client_users(id) ON DELETE SET NULL;

-- Auto-update triggers
CREATE OR REPLACE FUNCTION update_staff_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_staff_updated_at();

CREATE OR REPLACE FUNCTION update_client_users_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER client_users_updated_at
  BEFORE UPDATE ON client_users
  FOR EACH ROW EXECUTE FUNCTION update_client_users_updated_at();;

-- Rename clients.name → clients.business_name (Notion uses Business Name semantics)
ALTER TABLE clients RENAME COLUMN name TO business_name;

-- Add scaling_manager_id FK referencing staff
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS scaling_manager_id uuid REFERENCES staff(id) ON DELETE SET NULL;

-- Helpful index for filtering clients by scaling manager
CREATE INDEX IF NOT EXISTS clients_scaling_manager_id_idx
  ON clients(scaling_manager_id);;

-- Internal staff notes per client (NT-1, NT-2 user stories)
CREATE TABLE IF NOT EXISTS client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_notes_client_id_idx ON client_notes(client_id, created_at DESC);

-- Soft-delete flag for archived/churned clients (LC-3)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;;

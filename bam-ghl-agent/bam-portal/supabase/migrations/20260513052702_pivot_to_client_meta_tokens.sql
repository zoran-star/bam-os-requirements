DROP TABLE IF EXISTS staff_meta_tokens;

CREATE TABLE client_meta_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  fb_user_id text NOT NULL,
  fb_user_name text,
  access_token text NOT NULL,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

ALTER TABLE client_meta_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client reads own meta token"
  ON client_meta_tokens FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX idx_client_meta_tokens_client_id ON client_meta_tokens(client_id);;

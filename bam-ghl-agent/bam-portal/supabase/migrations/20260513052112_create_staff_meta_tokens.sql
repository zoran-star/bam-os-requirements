CREATE TABLE staff_meta_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  fb_user_id text NOT NULL,
  fb_user_name text,
  access_token text NOT NULL,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

ALTER TABLE staff_meta_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff reads own token"
  ON staff_meta_tokens FOR SELECT
  USING (staff_user_id = auth.uid());

CREATE INDEX idx_staff_meta_tokens_staff_user_id ON staff_meta_tokens(staff_user_id);;

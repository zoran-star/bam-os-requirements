CREATE TABLE IF NOT EXISTS staff_calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL UNIQUE,
  google_email text,
  refresh_token text NOT NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE staff_calendar_tokens IS 'Per-staff Google Calendar OAuth refresh tokens. One row per staff auth user. staff_user_id = auth.users id.';;

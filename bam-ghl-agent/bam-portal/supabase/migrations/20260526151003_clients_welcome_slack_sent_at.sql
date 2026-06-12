
-- Tracks whether the "Welcome to your portal — notifications will land
-- here" message has been posted to the client's Slack channel after
-- they accept their invite + set their password. Idempotent: API
-- endpoint short-circuits if non-null. Set NULL means never posted.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS welcome_slack_sent_at timestamptz;
;

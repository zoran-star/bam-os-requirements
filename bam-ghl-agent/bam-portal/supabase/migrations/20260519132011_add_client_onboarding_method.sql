ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_method text
    CHECK (onboarding_method IN ('call', 'send_link')),
  ADD COLUMN IF NOT EXISTS call_completed_at timestamptz;

COMMENT ON COLUMN public.clients.onboarding_method IS 'How the client gets onboarded: ''call'' (Zoom/phone walkthrough) or ''send_link'' (self-serve via emailed invite). Drives the status pill on the Clients list.';
COMMENT ON COLUMN public.clients.call_completed_at IS 'Set when staff checks ''Call done?'' on the Setup tab. Backend also flips status to ''active'' on the same write.';;


ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_in_progress boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clients.onboarding_in_progress IS
  'Staff toggle. When TRUE (default), client sees the full portal including Business Blueprint, Resources, Messages, Team. When FALSE, client only sees Systems + Marketing tabs.';
;


-- Tie onboarding submissions to a specific client (one row per client_id when set).
-- Anon submissions still allowed (client_id NULL, keyed by submission_key).
ALTER TABLE public.onboarding_reloaded
  ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX onboarding_reloaded_client_id_uidx
  ON public.onboarding_reloaded (client_id)
  WHERE client_id IS NOT NULL;
;

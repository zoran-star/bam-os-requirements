ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS stripe_joined_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS members_stripe_joined_idx
  ON public.members (client_id, stripe_joined_at DESC);;

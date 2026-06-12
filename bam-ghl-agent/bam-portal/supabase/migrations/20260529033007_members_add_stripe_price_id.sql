ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
CREATE INDEX IF NOT EXISTS members_stripe_price_idx ON public.members (client_id, stripe_price_id);;

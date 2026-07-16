-- Cancellation snapshots: capture who/what a member was AT cancel time.
-- Cancelled members are DELETED from `members`, so churned-vs-active
-- comparisons (avg tenure, avg monthly revenue, avg total spend) need these
-- values frozen on the cancellations row. Written by actionCancel
-- (api/members.js) and handleSubDeleted (api/stripe/webhook.js); historical
-- rows are filled by scripts/backfill-cancellations.mjs from Stripe.
-- offer_id is a plain UUID (no FK) because the offers table is created
-- outside the migrations chain and local replay order would break the ref.
ALTER TABLE public.cancellations
  ADD COLUMN IF NOT EXISTS joined_date          DATE,
  ADD COLUMN IF NOT EXISTS plan_name            TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id      TEXT,
  ADD COLUMN IF NOT EXISTS offer_id             UUID,
  ADD COLUMN IF NOT EXISTS monthly_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS total_spent_cents    INTEGER,
  ADD COLUMN IF NOT EXISTS payments_count       INTEGER,
  ADD COLUMN IF NOT EXISTS source               TEXT,
  ADD COLUMN IF NOT EXISTS involuntary          BOOLEAN DEFAULT false;

-- Running lifetime spend on live members (the "active" side of the same
-- comparison). Refreshed by the spend-sync action in api/members.js.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS total_spent_cents INTEGER,
  ADD COLUMN IF NOT EXISTS payments_count    INTEGER,
  ADD COLUMN IF NOT EXISTS spend_synced_at   TIMESTAMPTZ;

-- Per-academy staff notification phone. When a new parent signs up + pays on
-- the onboarding funnel, the Stripe webhook texts this number with the signup
-- details. Nullable; falls back to the STAFF_NOTIFY_PHONE env var when unset.
alter table public.clients add column if not exists staff_notify_phone text;

comment on column public.clients.staff_notify_phone is
  'E.164 phone texted on a new paid signup (Stripe webhook → GHL SMS). Falls back to STAFF_NOTIFY_PHONE env when null.';

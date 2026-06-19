alter table public.clients add column if not exists staff_notify_phone text;
comment on column public.clients.staff_notify_phone is 'E.164 phone texted on a new paid signup (Stripe webhook -> GHL SMS). Falls back to STAFF_NOTIFY_PHONE env when null.';;

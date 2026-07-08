-- Returning Client Enroll (Members V2): per-staff grant.
--
-- The academy OWNER decides which teammates can use the "+ Returning client"
-- signup flow (enroll an existing Stripe customer onto a live offer without
-- the public checkout). Opt-IN like can_train_agent (default false); the
-- owner always has the ability regardless of this flag.

alter table public.client_users
  add column if not exists can_enroll_members boolean not null default false;

comment on column public.client_users.can_enroll_members is
  'When true, this client user can use the Returning Client Enroll flow in the Members tab (sign an existing Stripe customer onto a live offer). The owner always can. Granted by the academy owner in the Team section. Default false.';

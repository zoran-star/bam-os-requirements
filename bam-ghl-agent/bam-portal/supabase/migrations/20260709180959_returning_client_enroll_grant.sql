-- Returning Client Enroll (Members V2): per-staff grant.
alter table public.client_users
  add column if not exists can_enroll_members boolean not null default false;

comment on column public.client_users.can_enroll_members is
  'When true, this client user can use the Returning Client Enroll flow in the Members tab (sign an existing Stripe customer onto a live offer). The owner always can. Granted by the academy owner in the Team section. Default false.';

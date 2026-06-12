-- Onboarding action items: system-seeded steps with a stable key + ordering.
-- onboarding_key NULL = normal ad-hoc item. Non-null = one of the fixed
-- onboarding steps (slack | connect_stripe | create_ghl | connect_ghl).
alter table public.action_items
  add column if not exists onboarding_key text,
  add column if not exists sort_order int not null default 0;

-- One row per (client, onboarding_key). NULLs are distinct, so ad-hoc items
-- (onboarding_key NULL) are unaffected and can be many per client.
create unique index if not exists action_items_client_onboarding_key_uk
  on public.action_items (client_id, onboarding_key);;

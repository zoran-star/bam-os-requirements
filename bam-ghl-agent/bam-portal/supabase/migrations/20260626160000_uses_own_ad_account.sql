-- Marketing tab redesign (Setup section): does the client run their own ad
-- account? Default false = BAM-managed (the Leadsie connect-link onboarding
-- path). True = the client uses their own account (extra onboarding steps).
alter table public.clients
  add column if not exists uses_own_ad_account boolean not null default false;

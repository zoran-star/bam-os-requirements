-- Signal column for the new 'connect_ads' onboarding step (client connected
-- their ad account via the Leadsie share link). Mirrors the other *_at signal
-- columns the onboarding action items reconcile against.
alter table public.clients add column if not exists ads_connected_at timestamptz;;

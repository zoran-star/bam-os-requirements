alter table public.clients
  add column if not exists ghl_synced_at timestamptz;

comment on column public.clients.ghl_synced_at is
  'Last time the funnel dashboard pulled fresh GHL data for this client (stale-while-revalidate).';;

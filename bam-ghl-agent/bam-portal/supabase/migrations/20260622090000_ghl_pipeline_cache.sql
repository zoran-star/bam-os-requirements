-- Short-lived cache of the assembled GHL pipeline-board payload, per academy.
-- The board endpoint (api/ghl/pipelines.js) builds this from many GHL calls
-- (pipelines + an opportunity search per pipeline + a calendar-events call per
-- calendar). Caching it ~30s makes quick re-opens instant and lets a GHL 429
-- serve the last good board instead of failing. Service-role API only.

create table if not exists public.ghl_pipeline_cache (
  client_id   uuid primary key references public.clients(id) on delete cascade,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.ghl_pipeline_cache enable row level security;
-- No policies: only the service-role API (which bypasses RLS) touches this.

comment on table public.ghl_pipeline_cache is
  'Per-academy cache of the pipeline-board payload (~30s TTL). Lets api/ghl/pipelines serve repeat opens without hitting GHL and serve stale data on a GHL 429.';

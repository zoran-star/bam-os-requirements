-- Metrics tie-back (accepted design 2026-07-15): events wear the exact repo
-- artifact ids, so performance joins back to pages + components across clients.

alter table funnel_events add column if not exists page_key text;
alter table funnel_events add column if not exists component_key text;

-- The per-client page->component map, pushed by bam-client-sites
-- scripts/sync-tracking.mjs --push. One row per (client, page).
create table if not exists site_pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  slug text not null,
  page_key text not null,
  file text,
  components jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique (client_id, page_key)
);

alter table site_pages enable row level security;
-- service-role writes only (the sync script); no anon/authenticated policies.

create index if not exists funnel_events_page_key_idx on funnel_events (client_id, page_key) where page_key is not null;

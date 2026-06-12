alter table public.ghl_funnel_events
  add column if not exists excluded boolean not null default false,
  add column if not exists excluded_at timestamptz;

comment on column public.ghl_funnel_events.excluded is
  'Soft-delete for KPI cleaning: hidden from KPIs/board and not resurrected by re-pull (merge-duplicates omits this column so it is retained). The trash bin = excluded=true rows.';

create index if not exists idx_ghl_events_excluded
  on public.ghl_funnel_events (client_id, excluded);;

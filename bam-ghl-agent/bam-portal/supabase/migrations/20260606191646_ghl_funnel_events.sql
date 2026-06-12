create table if not exists public.ghl_funnel_events (
  id            bigint generated always as identity primary key,
  client_id     uuid,
  ghl_location  text,
  event_type    text not null,
  contact_id    text,
  contact_email text,
  contact_phone text,
  ref           text,
  value         numeric,
  occurred_at   timestamptz not null default now(),
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists uq_ghl_event_type_ref
  on public.ghl_funnel_events (event_type, ref) where ref is not null;

create index if not exists idx_ghl_events_client_time
  on public.ghl_funnel_events (client_id, occurred_at);
create index if not exists idx_ghl_events_client_type_time
  on public.ghl_funnel_events (client_id, event_type, occurred_at);

alter table public.ghl_funnel_events enable row level security;;

-- Lead routing: one row per place leads can enter an academy's funnel.
-- "Connected" = pipeline_name + stage_name set. The website leads API
-- routes website-form rows; ghl-form/calendar/funnel rows document and
-- standardize routing config per academy (enforced in GHL for now).
create table public.entry_points (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null check (type in ('website-form','ghl-form','funnel','calendar')),
  key text not null,            -- website form_type, or GHL form/calendar id
  label text not null,
  tags text[] not null default '{}',
  pipeline_name text,
  stage_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, type, key)
);

alter table public.entry_points enable row level security; -- service-key access only

-- Seed BAM GTA's known entry points when that production client row exists.
-- Fresh local databases do not include production client data, so this must be
-- a no-op there rather than violating the entry_points.client_id FK.
insert into public.entry_points (client_id, type, key, label, tags)
select c.id, v.type, v.key, v.label, v.tags
from public.clients c
cross join (
  values
    ('website-form','contact','Website Contact Form', array['website-inquiry','contact form filled']::text[]),
    ('website-form','free-trial','Website Free Trial', array['website-inquiry','free trial form filled']::text[]),
    ('ghl-form','GLI35e0zHS4cFrft92le','GHL Contact Form', array[]::text[]),
    ('ghl-form','00MuBSi1GxsRcSqklOkF','GHL Free Trial Form', array[]::text[]),
    ('calendar','Cmw4bCVBhexgi0Oi0Dkf','Booking Calendar: Group 1 (Elementary)', array[]::text[]),
    ('calendar','G5y4QI0MsFq3159IhFU7','Booking Calendar: Group 2 (High School)', array[]::text[])
) as v(type, key, label, tags)
where c.id = '39875f07-0a4b-4429-a201-2249bc1f24df'
on conflict (client_id, type, key) do nothing;;

-- Funnels (landing pages V2, 2026-07-08): a funnel = one page on the academy
-- site (landing page) where direct entry points live. Zoran's model: a DIRECT
-- entry point is a form or calendar, and those always sit inside a funnel.
-- funnels.key matches funnel_events.funnel so analytics joins by key.
-- url is the page URL for previews/config; NULL = derive from funnel_events
-- beacons at read time (api/website/funnels.js), settable from the portal.
create table public.funnels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  offer_id uuid references public.offers(id),
  key text not null,            -- matches funnel_events.funnel
  label text not null,
  url text,
  is_primary boolean not null default false,  -- the offer's main landing page
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, key)
);
alter table public.funnels enable row level security; -- service-key access only

alter table public.entry_points
  add column if not exists funnel_id uuid references public.funnels(id) on delete set null;

-- Backfill BAM GTA's Training-offer funnels. Guarded on the prod client row
-- so fresh local replays no-op (seeds provide the local fixtures).
insert into public.funnels (client_id, offer_id, key, label, is_primary)
select c.id, v.offer_id::uuid, v.key, v.label, v.is_primary
from public.clients c
cross join (values
  ('52a6285c-7832-44e1-b531-ab7ef9d8fc21', 'free-trial', 'Free trial landing page', true),
  ('52a6285c-7832-44e1-b531-ab7ef9d8fc21', 'contact',    'Contact page',            false),
  ('52a6285c-7832-44e1-b531-ab7ef9d8fc21', 'enroll',     'Enrollment funnel',       false)
) as v(offer_id, key, label, is_primary)
where c.id = '39875f07-0a4b-4429-a201-2249bc1f24df'
on conflict (client_id, key) do nothing;

-- Link GTA's direct entry points to their funnels: the free-trial page hosts
-- the trial form + both booking calendars; the contact page hosts the contact
-- form. (Enroll has no lead entry points; ADAPT intake has no funnel yet.)
update public.entry_points ep
   set funnel_id = f.id
  from public.funnels f
 where ep.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and f.client_id = ep.client_id
   and ep.funnel_id is null
   and f.key = case
         when ep.type = 'calendar' then 'free-trial'
         when ep.type = 'website-form' and ep.key = 'free-trial' then 'free-trial'
         when ep.type = 'website-form' and ep.key = 'contact' then 'contact'
       end;

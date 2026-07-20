-- Content Library taxonomy (Track 2 / P1, approved 2026-07-20).
-- Extends the live client_assets library with structured content typing +
-- person/skill tags so the content team can search the library when building
-- ads. Additive only - nothing renamed or dropped.
--
--   content_type: action | coaching | culture | testimonial
--   action       -> athlete tags (contacts) + skill tags + highlight/lowlight
--   coaching     -> staff tags (client_users; name-only rows are valid)
--   culture      -> athlete + staff tags
--   testimonial  -> athlete + staff tags
--
-- Conditional rules are enforced in UI/API, not DB (staff bulk-tagging needs
-- slack). Handoff: docs/core-handoff/content-library-tickets.md

-- 1 - typed content on the asset row itself
alter table public.client_assets
  add column if not exists content_type text
    check (content_type in ('action','coaching','culture','testimonial')),
  add column if not exists highlight boolean;  -- action only: true=highlight, false=lowlight

create index if not exists client_assets_content_type_idx
  on public.client_assets(client_id, content_type);

comment on column public.client_assets.content_type is
  'Content Library taxonomy: action|coaching|culture|testimonial. Null = untyped (brand assets etc).';
comment on column public.client_assets.highlight is
  'Action content only: true=highlight, false=lowlight, null=n/a.';

-- 2 - person tags: athletes reference contacts (portal person store),
--     staff reference client_users (name-only pre-invite rows are valid).
--     display_name is a render/search snapshot, never the identifier.
create table if not exists public.client_asset_people (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references public.client_assets(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  role           text not null check (role in ('athlete','staff')),
  contact_id     uuid references public.contacts(id) on delete cascade,
  client_user_id uuid references public.client_users(id) on delete cascade,
  display_name   text not null,
  created_at     timestamptz not null default now(),
  check ((role = 'athlete' and contact_id is not null and client_user_id is null)
      or (role = 'staff'   and client_user_id is not null and contact_id is null))
);
create unique index if not exists client_asset_people_contact_uidx
  on public.client_asset_people(asset_id, contact_id) where contact_id is not null;
create unique index if not exists client_asset_people_user_uidx
  on public.client_asset_people(asset_id, client_user_id) where client_user_id is not null;
create index if not exists client_asset_people_search_idx
  on public.client_asset_people(client_id, role, display_name);
create index if not exists client_asset_people_asset_idx
  on public.client_asset_people(asset_id);

comment on table public.client_asset_people is
  'Person tags on Content Library assets. athlete->contacts, staff->client_users. display_name is a snapshot that survives merges/removals.';

-- 3 - per-academy skill presets (6 defaults seeded; clients add their own)
create table if not exists public.client_content_skills (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  slug       text not null,
  label      text not null,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, slug)
);

comment on table public.client_content_skills is
  'Per-academy skill vocabulary for action content. 6 defaults seeded per V2 academy; clients append custom rows. Default rows undeletable by clients.';

-- 4 - asset<->skill join
create table if not exists public.client_asset_skills (
  asset_id   uuid not null references public.client_assets(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  skill_slug text not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, skill_slug),
  foreign key (client_id, skill_slug)
    references public.client_content_skills(client_id, slug) on delete cascade
);
create index if not exists client_asset_skills_skill_idx
  on public.client_asset_skills(client_id, skill_slug);

-- 5 - RLS (house pattern; client writes blocked on ticket-sourced assets,
--     mirroring 20260709184749)
alter table public.client_asset_people enable row level security;
create policy cap_staff_all on public.client_asset_people
  for all using (is_staff()) with check (is_staff());
create policy cap_client_select on public.client_asset_people
  for select using (client_id in (select my_client_ids()));
create policy cap_client_insert on public.client_asset_people
  for insert with check (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and a.client_id = client_asset_people.client_id
                  and coalesce(a.source,'manual') <> 'ticket'));
create policy cap_client_delete on public.client_asset_people
  for delete using (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and coalesce(a.source,'manual') <> 'ticket'));

alter table public.client_content_skills enable row level security;
create policy ccs_staff_all on public.client_content_skills
  for all using (is_staff()) with check (is_staff());
create policy ccs_client_select on public.client_content_skills
  for select using (client_id in (select my_client_ids()));
create policy ccs_client_insert on public.client_content_skills
  for insert with check (client_id in (select my_client_ids()) and is_default = false);
create policy ccs_client_update on public.client_content_skills
  for update using (client_id in (select my_client_ids()) and is_default = false)
  with check (client_id in (select my_client_ids()) and is_default = false);
create policy ccs_client_delete on public.client_content_skills
  for delete using (client_id in (select my_client_ids()) and is_default = false);

alter table public.client_asset_skills enable row level security;
create policy cas_staff_all on public.client_asset_skills
  for all using (is_staff()) with check (is_staff());
create policy cas_client_select on public.client_asset_skills
  for select using (client_id in (select my_client_ids()));
create policy cas_client_insert on public.client_asset_skills
  for insert with check (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and a.client_id = client_asset_skills.client_id
                  and coalesce(a.source,'manual') <> 'ticket'));
create policy cas_client_delete on public.client_asset_skills
  for delete using (
    client_id in (select my_client_ids())
    and exists (select 1 from public.client_assets a
                where a.id = asset_id and coalesce(a.source,'manual') <> 'ticket'));

-- 6 - seed the 6 default skills for every V2 academy (API lazy-seeds later flips)
insert into public.client_content_skills (client_id, slug, label, is_default, sort_order)
select c.id, s.slug, s.label, true, s.ord
from public.clients c
cross join (values
  ('ball-handling','Ball handling',1),
  ('shooting','Shooting',2),
  ('game-iq','Game IQ',3),
  ('defense','Defense',4),
  ('athleticism','Athleticism',5),
  ('passing','Passing',6)
) as s(slug, label, ord)
where c.v2_access = true
on conflict (client_id, slug) do nothing;

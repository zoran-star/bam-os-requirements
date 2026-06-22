-- V1.5 Contacts tab: a per-academy mirror of GHL contacts (kept fresh by the
-- sync) so search by parent/athlete name + phone + email and tag filtering are
-- instant + reliable. athlete_name is resolved at sync time from the academy's
-- mapped GHL custom field(s) (clients.v15_config.athlete_name_field_ids).
create extension if not exists pg_trgm;

create table if not exists public.ghl_contacts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id  text not null,
  first_name      text,
  last_name       text,
  name            text,
  email           text,
  phone           text,
  tags            text[] not null default '{}',
  athlete_name    text,
  custom_fields   jsonb not null default '{}',
  date_added      timestamptz,
  synced_at       timestamptz not null default now(),
  unique (client_id, ghl_contact_id)
);
create index if not exists ghl_contacts_client_idx on public.ghl_contacts(client_id);
create index if not exists ghl_contacts_tags_idx   on public.ghl_contacts using gin(tags);
create index if not exists ghl_contacts_search_idx on public.ghl_contacts using gin (
  (coalesce(name,'') || ' ' || coalesce(athlete_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) gin_trgm_ops
);

comment on table public.ghl_contacts is 'Per-academy mirror of GHL contacts for the V1.5 Contacts tab. Refreshed by the contact sync; athlete_name resolved from mapped custom field(s).';

alter table public.ghl_contacts enable row level security;
create policy ghl_contacts_select on public.ghl_contacts for select using (is_staff() or client_id in (select my_client_ids()));
create policy ghl_contacts_write  on public.ghl_contacts for all using (is_staff()) with check (is_staff());

-- V1.5 config bag on the client (athlete-name custom-field mapping lives here).
alter table public.clients add column if not exists v15_config jsonb not null default '{}'::jsonb;;

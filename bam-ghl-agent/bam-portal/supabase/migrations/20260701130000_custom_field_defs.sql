-- Owner-managed custom fields (Contacts effort, PR 4a - schema). ADDITIVE, DORMANT.
-- Today a contact's custom fields are an opaque jsonb blob keyed by GHL field ids
-- (contacts.custom_fields), which the portal cannot manage or render by label.
-- This lays a portal-owned field-definition system so an academy owner can define
-- their own fields (like GHL's custom-fields UI, but ours) and values render by
-- label + feed the merge-var resolver. Nothing reads these yet; no UI ships here.

-- 1. custom_field_defs: one row per (academy, field) ------------------------
create table if not exists public.custom_field_defs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  key          text not null,                 -- stable slug e.g. 'athlete_grade'
  label        text not null,                 -- display name e.g. 'Athlete Grade'
  type         text not null default 'text' check (type in (
                 'text','number','date','select','multiselect','boolean','phone','email','url')),
  options      jsonb not null default '[]'::jsonb,  -- choices for select/multiselect
  position     int  not null default 0,        -- order in the UI
  required     boolean not null default false,
  archived     boolean not null default false,
  -- Reconciliation: which GHL custom-field id this maps to (null once GHL is off
  -- for the academy). Lets a later migration fold contacts.custom_fields (keyed
  -- by GHL id) into typed values, and lets dual-write push back to GHL while on it.
  ghl_field_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, key)
);
create index if not exists custom_field_defs_client_idx on public.custom_field_defs(client_id);
create unique index if not exists custom_field_defs_ghl_idx
  on public.custom_field_defs(client_id, ghl_field_id) where ghl_field_id is not null;

alter table public.custom_field_defs enable row level security;
do $$ begin
  create policy custom_field_defs_select on public.custom_field_defs
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy custom_field_defs_write on public.custom_field_defs
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.custom_field_defs is
  'Owner-managed custom-field definitions per academy (portal-native replacement for GHL custom fields). ghl_field_id reconciles to GHL while still dual-writing; null once GHL is off.';

-- 2. contact_field_values: typed value per (contact, field) -----------------
create table if not exists public.contact_field_values (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  field_id   uuid not null references public.custom_field_defs(id) on delete cascade,
  value      jsonb,                            -- typed by the def (string/number/array/bool)
  updated_at timestamptz not null default now(),
  unique (contact_id, field_id)
);
create index if not exists contact_field_values_contact_idx on public.contact_field_values(contact_id);
create index if not exists contact_field_values_field_idx   on public.contact_field_values(field_id);

alter table public.contact_field_values enable row level security;
-- Value visibility follows the parent contact's academy (join to contacts).
do $$ begin
  create policy contact_field_values_select on public.contact_field_values
    for select using (exists (
      select 1 from public.contacts c
      where c.id = contact_field_values.contact_id
        and (is_staff() or c.client_id in (select my_client_ids()))));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy contact_field_values_write on public.contact_field_values
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.contact_field_values is
  'Typed custom-field values per contact, typed by custom_field_defs. Dormant until the field-defs UI + GHL-blob migration land.';

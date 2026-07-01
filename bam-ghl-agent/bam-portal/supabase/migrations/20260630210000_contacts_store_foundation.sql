-- Own-contacts store foundation (Contacts effort, PR 1). PURELY ADDITIVE, DORMANT.
-- Lays the system-of-record for people so GHL can eventually be turned off for
-- contacts, mirroring the pipeline-store (20260629170000) and messaging-spine
-- (20260629150000) own-store patterns: a per-academy provider toggle + a ghl_*
-- bridge column for safe cutover, plus a one-time backfill from the existing
-- ghl_contacts mirror so nothing has to be re-uploaded.
--
-- Nothing reads this table yet. Every academy stays contact_provider='ghl' (the
-- default), so the roster, the agents, the inbox, and the sync cron behave
-- byte-identically to before. V1/V1.5 untouched. BAM GTA (client_id
-- 39875f07-0a4b-4429-a201-2249bc1f24df, V2) is the first flip target in a later PR.
-- Custom-field DEFINITIONS (owner-managed) are a separate later PR; for now the
-- opaque GHL custom_fields blob is carried forward so no data is lost.

-- 1. The provider toggle (mirrors clients.pipeline_provider / messaging_provider) --
alter table public.clients
  add column if not exists contact_provider text not null default 'ghl';
do $$ begin
  alter table public.clients
    add constraint clients_contact_provider_chk
    check (contact_provider in ('ghl','portal'));
exception when duplicate_object then null; end $$;
comment on column public.clients.contact_provider is
  'System-of-record for contacts: ''ghl'' (default) or ''portal'' (own contacts store). Flip to ''portal'' only after the backfill has reconciled and portal writes dual-write to GHL. V1/V1.5 stay ''ghl''.';

-- 2. contacts: the portal-owned people store ---------------------------------
-- One row per person (lead / parent / member contact). The system-of-record once
-- an academy is flipped to provider='portal'; a shadow mirror of ghl_contacts
-- while still on GHL. ghl_contact_id is the reconciliation bridge and lines up
-- with members.ghl_contact_id, opportunities.ghl_contact_id, website_leads, and
-- the inbox so every existing join keeps working. custom_fields carries the GHL
-- blob verbatim until the owner-managed field-definition system lands.
create table if not exists public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,

  -- Reconciliation bridge (null once GHL is fully off for this academy).
  ghl_contact_id     text,

  -- Identity.
  first_name         text,
  last_name          text,
  name               text,
  email              text,
  phone              text,                  -- E.164, bridges to sms_threads
  athlete_name       text,

  -- Carry-forward fields (own these properly in later PRs).
  tags               text[] not null default '{}',
  custom_fields      jsonb  not null default '{}'::jsonb,  -- opaque GHL blob until field-defs PR
  dnd                boolean not null default false,
  stripe_customer_id text,

  -- Provenance.
  source             text,                  -- 'ghl-import' | 'website-form' | 'agent' | 'manual'

  -- Timeline.
  date_added         timestamptz,           -- original GHL date_added, preserved
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- One portal contact per GHL contact (idempotent backfill + dual-write).
  unique (client_id, ghl_contact_id)
);
create index if not exists contacts_client_idx        on public.contacts(client_id);
create index if not exists contacts_ghl_idx           on public.contacts(client_id, ghl_contact_id);
create index if not exists contacts_email_idx         on public.contacts(client_id, lower(email));
create index if not exists contacts_phone_idx         on public.contacts(client_id, phone);
create index if not exists contacts_tags_idx          on public.contacts using gin (tags);
create index if not exists contacts_stripe_idx        on public.contacts(stripe_customer_id);

alter table public.contacts enable row level security;
do $$ begin
  create policy contacts_select on public.contacts
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy contacts_write on public.contacts
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.contacts is
  'Portal-native contacts store (system-of-record for people on contact_provider=portal). While on GHL it shadow-mirrors ghl_contacts via backfill + dual-write; ghl_contact_id reconciles and lines up with members/opportunities/website_leads/inbox. custom_fields is the opaque GHL blob until the owner-managed field-definition system lands.';

-- 3. One-time backfill from the existing ghl_contacts mirror -----------------
-- Idempotent: re-running does nothing (unique client_id + ghl_contact_id).
-- On fresh local replay ghl_contacts may be empty; the insert is then a no-op.
-- Purely populates the dormant store; nothing reads it, so this is behavior-safe.
insert into public.contacts (
  client_id, ghl_contact_id, first_name, last_name, name, email, phone,
  athlete_name, tags, custom_fields, dnd, stripe_customer_id, source, date_added
)
select
  gc.client_id,
  gc.ghl_contact_id,
  gc.first_name,
  gc.last_name,
  gc.name,
  gc.email,
  gc.phone,
  gc.athlete_name,
  coalesce(gc.tags, '{}'),
  coalesce(gc.custom_fields, '{}'::jsonb),
  coalesce(gc.dnd, false),
  gc.stripe_customer_id,
  'ghl-import',
  gc.date_added
from public.ghl_contacts gc
where gc.ghl_contact_id is not null
on conflict (client_id, ghl_contact_id) do nothing;

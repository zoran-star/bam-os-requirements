-- Off-GHL pipeline store foundation (Effort E, PR 1). PURELY ADDITIVE, DORMANT.
-- Lays the system-of-record for the sales board so GHL can eventually be turned
-- off, mirroring the messaging-spine own-store pattern (migration 20260629150000):
-- a per-academy provider toggle + a ghl_* bridge column for safe cutover.
--
-- Nothing reads these tables yet and nothing writes to GHL differently. Every
-- academy stays pipeline_provider='ghl' (the default), so the board, the agents,
-- and the _stage.js finders behave byte-identically to before. V1/V1.5 untouched.
-- BAM GTA (client_id 39875f07-0a4b-4429-a201-2249bc1f24df, V2) is the first flip
-- target in a later PR. See docs/off-ghl-pipeline-store-design.md.

-- 1. The provider toggle (mirrors clients.messaging_provider) -----------------
alter table public.clients
  add column if not exists pipeline_provider text not null default 'ghl';
do $$ begin
  alter table public.clients
    add constraint clients_pipeline_provider_chk
    check (pipeline_provider in ('ghl','portal'));
exception when duplicate_object then null; end $$;
comment on column public.clients.pipeline_provider is
  'System-of-record for the sales board: ''ghl'' (default) or ''portal'' (own opportunities store). Flip to ''portal'' only after dual-write has backfilled and reconciled. V1/V1.5 stay ''ghl''.';

-- 2. pipeline_stages: the stage-role registry --------------------------------
-- One row per (academy, role). Code asks the registry for "the responded stage
-- for this academy" instead of regex-matching GHL stage NAMES. Seeded from GHL
-- once (scripts/seed-stages.js fills the ghl_* columns); the source of truth
-- once an academy is flipped. ghl_* columns let the finders return GHL ids while
-- still on GHL, and just go null when GHL is fully off.
create table if not exists public.pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  role            text not null check (role in (
                    'responded','interested','scheduled_trial','done_trial',
                    'nurture','won','unqualified')),
  label           text,                       -- display name e.g. "Booking"
  position        int  not null default 0,    -- board column order
  -- GHL reconciliation: which GHL pipeline+stage this role currently maps to.
  -- Lets P1 dual-write and lets the finders return GHL ids while still on GHL.
  ghl_pipeline_id text,
  ghl_stage_id    text,
  ghl_stage_name  text,
  is_terminal     boolean not null default false,  -- won / unqualified
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, role)
);
create index if not exists pipeline_stages_client_idx on public.pipeline_stages(client_id);

alter table public.pipeline_stages enable row level security;
do $$ begin
  create policy pipeline_stages_select on public.pipeline_stages
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy pipeline_stages_write on public.pipeline_stages
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.pipeline_stages is
  'Per-academy stage-role registry. Decouples code from GHL stage names: finders resolve a ROLE to a stage here instead of regex-matching GHL. ghl_* columns reconcile to GHL while still dual-writing.';

-- 3. opportunities: the portal-owned opportunity store -----------------------
-- One row per lead's run through the sales pipeline. The system-of-record once
-- an academy is flipped to provider='portal'; a dual-written shadow mirror while
-- still on GHL. ghl_opportunity_id is the reconciliation bridge; ghl_contact_id /
-- contact_phone line up with sms_threads so the two own-stores join cleanly.
create table if not exists public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,

  -- Who: link to contact + member. ghl_contact_id keeps board+agents working.
  ghl_contact_id       text,
  contact_phone        text,                  -- E.164, bridges to sms_threads
  contact_name         text,
  athlete_name         text,
  member_id            uuid references public.members(id) on delete set null,

  -- Where in the pipeline: ROLE is the contract; stage_id points at the registry.
  stage_role           text not null default 'responded' check (stage_role in (
                         'responded','interested','scheduled_trial','done_trial',
                         'nurture','won','unqualified')),
  stage_id             uuid references public.pipeline_stages(id) on delete set null,

  -- Open/closed lifecycle, independent of stage (a lead can be lost from any stage).
  status               text not null default 'open' check (status in (
                         'open','won','lost','abandoned')),

  -- Provenance.
  source               text,                  -- 'website-form' | 'agent' | 'import' | 'manual'
  entry_point          text,                  -- 'contact' | 'free-trial' | 'ghl-import' | ...
  monetary_value       numeric default 0,
  reason               text,                  -- free-text close reason (won/lost/abandoned)

  -- Reconciliation with GHL (the bridge; null once GHL is fully off).
  ghl_opportunity_id   text,
  ghl_pipeline_id      text,

  -- Timeline.
  last_stage_change_at timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- One portal opp per GHL opp (idempotent dual-write + import).
  unique (client_id, ghl_opportunity_id)
);
create index if not exists opportunities_client_stage_idx
  on public.opportunities(client_id, stage_role, status);
create index if not exists opportunities_contact_idx
  on public.opportunities(client_id, ghl_contact_id);
create index if not exists opportunities_phone_idx
  on public.opportunities(client_id, contact_phone);
-- Fast "who is open in this role" (replaces the GHL search the finders do).
create index if not exists opportunities_open_role_idx
  on public.opportunities(client_id, stage_role) where status = 'open';

alter table public.opportunities enable row level security;
do $$ begin
  create policy opportunities_select on public.opportunities
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy opportunities_write on public.opportunities
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.opportunities is
  'Portal-native opportunity store (system-of-record for the sales board on provider=portal). While on GHL it shadow-mirrors via dual-write; ghl_opportunity_id reconciles. stage_role is the code contract, stage_id points at pipeline_stages.';

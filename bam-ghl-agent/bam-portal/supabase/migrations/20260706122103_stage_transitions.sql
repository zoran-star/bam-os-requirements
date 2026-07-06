-- Sales Flow: systematized entry/exit-point taxonomy (per-academy authorable).
-- One row = one edge of an academy's flow graph. A stage's ENTRY points = edges
-- landing on it; EXIT points = edges leaving it. Provider-neutral stage roles
-- (mapped to a GHL/portal stage via resolveStage). Additive + idempotent.
-- Design: docs/core-handoff/sales-flow.md.

-- ── enums (BAM base library; academy rows reference these) ──
do $$ begin
  create type transition_trigger as enum (
    'new_lead','replied','went_quiet','booked','cant_make_it','no_show',
    'post_trial_good_fit','post_trial_not_fit','not_interested','no_longer_wants',
    'says_no','enrolls','marked_unqualified','complaint_offtopic','ghosted_ran_out'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type stage_role as enum (
    'responded','interested','scheduled_trial','done_trial','nurture'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type transition_destination_kind as enum ('stage','terminal');
exception when duplicate_object then null; end $$;

-- ── table ──
create table if not exists public.stage_transitions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  pipeline_id       text,                              -- provider pipeline id (nullable)
  from_stage_role   stage_role,                        -- null = external entry (e.g. new_lead)
  trigger           transition_trigger not null,
  to_kind           transition_destination_kind not null default 'stage',
  to_stage_role     stage_role,                        -- when to_kind = 'stage'
  to_terminal       text,                              -- when to_kind = 'terminal': member|unqualified|human
  enabled           boolean not null default true,
  carries_context   boolean not null default true,     -- "all carry context"
  is_seed           boolean not null default false,    -- came from the standard Sales-Crew seed
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint stage_transitions_dest_chk check (
    (to_kind = 'stage'    and to_stage_role is not null and to_terminal is null) or
    (to_kind = 'terminal' and to_terminal in ('member','unqualified','human') and to_stage_role is null)
  ),
  constraint stage_transitions_edge_uniq unique
    (client_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal)
);
create index if not exists stage_transitions_client_idx on public.stage_transitions(client_id);
create index if not exists stage_transitions_from_idx   on public.stage_transitions(client_id, from_stage_role);

-- updated_at touch (uniquely named so it never clobbers a shared helper)
create or replace function public.stage_transitions_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
drop trigger if exists stage_transitions_touch on public.stage_transitions;
create trigger stage_transitions_touch before update on public.stage_transitions
  for each row execute function public.stage_transitions_touch_updated_at();

-- ── RLS: tenant isolation (staff + academy owners), portal standard pattern ──
alter table public.stage_transitions enable row level security;
do $$ begin
  create policy stage_transitions_rw on public.stage_transitions
    for all to authenticated
    using      ( public.is_staff() or client_id in (select public.my_client_ids()) )
    with check ( public.is_staff() or client_id in (select public.my_client_ids()) );
exception when duplicate_object then null; end $$;

-- ── reusable seed: the standard Sales-Crew flow for ONE academy (idempotent) ──
-- BAM calls this per academy as a STARTING POINT; academies then author freely.
create or replace function public.seed_default_stage_transitions(p_client_id uuid) returns void as $$
begin
  insert into public.stage_transitions
    (client_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
  values
    -- Responded (Booking agent)
    (p_client_id, null,             'new_lead',            'stage',    'responded',       null,          true, 10),
    (p_client_id, 'responded',      'booked',              'stage',    'scheduled_trial', null,          true, 11),
    (p_client_id, 'responded',      'not_interested',      'stage',    'nurture',         null,          true, 12),
    (p_client_id, 'responded',      'marked_unqualified',  'terminal', null,              'unqualified', true, 13),
    (p_client_id, 'responded',      'went_quiet',          'stage',    'interested',      null,          true, 14),
    (p_client_id, 'responded',      'complaint_offtopic',  'terminal', null,              'human',       true, 15),
    -- Scheduled Trial (Confirm agent) + post-trial-form router outcomes
    (p_client_id, 'scheduled_trial','post_trial_good_fit', 'stage',    'done_trial',      null,          true, 20),
    (p_client_id, 'scheduled_trial','post_trial_not_fit',  'terminal', null,              'unqualified', true, 21),
    (p_client_id, 'scheduled_trial','no_show',             'stage',    'responded',       null,          true, 22),
    (p_client_id, 'scheduled_trial','cant_make_it',        'stage',    'responded',       null,          true, 23),
    (p_client_id, 'scheduled_trial','no_longer_wants',     'stage',    'nurture',         null,          true, 24),
    (p_client_id, 'scheduled_trial','marked_unqualified',  'terminal', null,              'unqualified', true, 25),
    (p_client_id, 'scheduled_trial','complaint_offtopic',  'terminal', null,              'human',       true, 26),
    -- Done Trial (Closing agent)
    (p_client_id, 'done_trial',     'enrolls',             'terminal', null,              'member',      true, 30),
    (p_client_id, 'done_trial',     'says_no',             'stage',    'nurture',         null,          true, 31),
    (p_client_id, 'done_trial',     'marked_unqualified',  'terminal', null,              'unqualified', true, 32),
    (p_client_id, 'done_trial',     'complaint_offtopic',  'terminal', null,              'human',       true, 33),
    -- Interested (Ghosted automation)
    (p_client_id, 'interested',     'replied',             'stage',    'responded',       null,          true, 40),
    (p_client_id, 'interested',     'ghosted_ran_out',     'stage',    'nurture',         null,          true, 41),
    -- Nurture (Lead Nurture automation)
    (p_client_id, 'nurture',        'replied',             'stage',    'responded',       null,          true, 50)
  on conflict on constraint stage_transitions_edge_uniq do nothing;
end $$ language plpgsql;

-- Per README: do NOT hard-insert academy rows here (FK fails on fresh local replay
-- before the client seed runs). BAM GTA's default flow is seeded post-migration by
-- calling seed_default_stage_transitions(<gta client id>).

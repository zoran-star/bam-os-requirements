-- Automation engine (P4a): the portal-native scheduler that will power the
-- 👻 Ghosted + 💔 Lead Nurture sequences (and retire the GHL workflows). Built
-- EMPTY - no sequences are populated here; the import session fills the steps and
-- the P6 triggers enroll contacts. Nothing sends until an academy has an automation
-- that is BOTH enabled AND approved, with >= 1 enabled step, AND a contact enrolled.
--
--   automations            - one row per (academy, sequence-key) e.g. 'ghosted','nurture'
--   automation_steps       - ordered wait->channel->message steps (the Brain step-builder)
--   automation_enrollments - a contact's run through one automation
--   automation_jobs        - the durable send queue (one row per scheduled step send)
--   automation_events      - append-only audit (enrolled / step_sent / completed / exited)

create table if not exists public.automations (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  automation_key text not null,                 -- 'ghosted' | 'nurture' | ...
  name           text,
  enabled        boolean not null default false,
  approved       boolean not null default false, -- Hawkeye: approve the SEQUENCE once
  ghl_stage_name text,                          -- the pipeline stage this owns (mirror)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_id, automation_key)
);

create table if not exists public.automation_steps (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references public.automations(id) on delete cascade,
  position       int  not null,
  wait_amount    int  not null default 0,
  wait_unit      text not null default 'days'
    check (wait_unit in ('minutes','hours','days','weeks','months')),
  channel        text not null check (channel in ('sms','email')),
  subject        text,                          -- email only
  body           text not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists automation_steps_automation_idx on public.automation_steps (automation_id, position);

create table if not exists public.automation_enrollments (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null,
  automation_id    uuid not null references public.automations(id) on delete cascade,
  contact_id       text not null,
  status           text not null default 'active'
    check (status in ('active','completed','exited','canceled')),
  current_position int default 0,
  entered_at       timestamptz not null default now(),
  exited_at        timestamptz,
  exit_reason      text
);
-- One active run per contact per automation (idempotent enroll).
create unique index if not exists automation_enrollments_one_active
  on public.automation_enrollments (client_id, automation_id, contact_id)
  where status = 'active';
create index if not exists automation_enrollments_contact_idx on public.automation_enrollments (client_id, contact_id);

create table if not exists public.automation_jobs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null,
  automation_id  uuid,
  enrollment_id  uuid references public.automation_enrollments(id) on delete cascade,
  step_id        uuid,
  contact_id     text not null,
  channel        text,
  run_after      timestamptz not null,
  status         text not null default 'pending'
    check (status in ('pending','sending','sent','skipped','failed','canceled')),
  dedupe_key     text,
  attempts       int not null default 0,
  last_error     text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
-- dedupe_key (= enrollment_id:step_id) makes scheduling idempotent: a given step of
-- a given enrollment can be queued at most once.
create unique index if not exists automation_jobs_dedupe on public.automation_jobs (dedupe_key) where dedupe_key is not null;
create index if not exists automation_jobs_due_idx on public.automation_jobs (status, run_after);

create table if not exists public.automation_events (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid,
  contact_id     text,
  automation_id  uuid,
  type           text,
  payload        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists automation_events_client_idx on public.automation_events (client_id, created_at);

alter table public.automations            enable row level security;
alter table public.automation_steps       enable row level security;
alter table public.automation_enrollments enable row level security;
alter table public.automation_jobs        enable row level security;
alter table public.automation_events      enable row level security;

-- Staff or the academy's own users can read; all writes go through the service-role
-- API (api/automations.js), which bypasses RLS and enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='automations' and policyname='automations_select') then
    create policy automations_select on public.automations for select using (is_staff() or client_id in (select my_client_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename='automation_steps' and policyname='automation_steps_select') then
    create policy automation_steps_select on public.automation_steps for select
      using (is_staff() or automation_id in (select id from public.automations where client_id in (select my_client_ids())));
  end if;
  if not exists (select 1 from pg_policies where tablename='automation_enrollments' and policyname='automation_enrollments_select') then
    create policy automation_enrollments_select on public.automation_enrollments for select using (is_staff() or client_id in (select my_client_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename='automation_jobs' and policyname='automation_jobs_select') then
    create policy automation_jobs_select on public.automation_jobs for select using (is_staff() or client_id in (select my_client_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename='automation_events' and policyname='automation_events_select') then
    create policy automation_events_select on public.automation_events for select using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.automations is 'Portal-native automation sequences (Ghosted / Lead Nurture). Inert until enabled+approved with steps + an enrollment.';
comment on table public.automation_jobs is 'Durable send queue for automation steps. dedupe_key + atomic pending->sending claim guarantee a step never double-sends.';

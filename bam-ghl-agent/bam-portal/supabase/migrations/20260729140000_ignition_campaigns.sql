-- REIGNITION campaigns (Build E). PURELY ADDITIVE, DORMANT.
-- Design (approved): docs/plans/ignition-template.html
-- Code: api/agent/reignition-station.js (the stage) + api/agent/reignition.js (the
-- campaign) + api/reignition.js (the staff actions and the admission cron).
--
-- NOT YET APPLIED - a human applies migrations in this repo.
--
-- WHAT THIS DOES NOT ADD, ON PURPOSE:
--   * no new message table, no new send queue, no new step table. A campaign's
--     messages are an ordinary row in `automations` (automation_key
--     'ignition:<slug>') with ordinary `automation_steps`, so they ride the
--     existing worker, renderer, quiet hours, time zones, empty-after-merge skip
--     and reply handling with nothing changed. There is exactly one send path in
--     this system and this feature does not add a second.
--   * no new stage_role vocabulary. 20260710181458 opened pipeline_stages.role and
--     opportunities.stage_role to any lowercase snake_case value, so 'reignition'
--     needs no DDL. The stage row itself is written by stampReignitionStage() on
--     first campaign approval, through the existing (client_id, role) upsert.
--   * no consent column on contacts. See the consent note on ignition_campaigns
--     .consent_basis below - it is the whole reason that column exists.

-- 1. ignition_campaigns -------------------------------------------------------
create table if not exists public.ignition_campaigns (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,

  -- Identity. slug is the human-typed handle and it is what names the campaign's
  -- automation ('ignition:' || slug), so it is stable and unique per academy.
  slug            text not null,
  name            text not null,

  -- draft    nothing sends, ever. The roster and the messages are built here.
  -- approved a human read the dry run and said yes. The cron may start admitting.
  -- running  admissions are in flight.
  -- done     every roster row reached a terminal state.
  -- halted   stopped by a human. Nobody else is ever admitted; whoever has not
  --          been reached is simply never reached. In-flight people finish their
  --          own sequence (halting does not yank a live conversation).
  state           text not null default 'draft'
                    check (state in ('draft','approved','running','done','halted')),

  -- Pacing is ADMISSION, not sending: this many people enter the stage per day.
  per_day         int not null default 15 check (per_day between 1 and 200),

  -- WHY THIS IS NOT NULL, and why it is free text a person writes.
  -- Positive consent does not exist as data anywhere in this system. The only
  -- columns are contacts.dnd / ghl_contacts.dnd (default false) and
  -- email_suppressions - all opt-OUT records. A "no consent on file -> exclude"
  -- rail would therefore wave through every imported lead who had simply never
  -- opted out: it would protect nobody while looking like a safeguard. So the
  -- basis is written by a human - where these leads came from and why we may
  -- message them - stored here, and shown beside the roster at the dry run where
  -- the approver has to read it. The length check is a "somebody typed something"
  -- bar; api/agent/reignition.js requires 10+ characters and the human is the
  -- actual review.
  consent_basis   text not null check (btrim(consent_basis) <> ''),

  -- The automation carrying this campaign's messages. FK-less on purpose: it is
  -- the same (client_id, automation_key) pair every other caller uses.
  automation_key  text not null,

  -- Which channels the campaign's steps use. The rails require a working address
  -- for EVERY channel named here, so nobody gets half a sequence.
  channels        text[] not null default '{sms}'::text[],

  offer_id        uuid references public.offers(id) on delete set null,

  -- WHO, not just when. Staff approval is the entire gate on messaging several
  -- hundred people who never asked to hear from us, so an approval with no name
  -- on it is not a gate. Stored as the actor's email (what resolveAgentActor
  -- already carries) rather than an auth uuid, so the roster and the audit read
  -- without a join. Both are WRITTEN by api/reignition.js - a declared-and-never
  -- -populated column is worse than no column, because it looks like a record.
  created_by      text,
  approved_by     text,
  approved_at     timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  halted_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (client_id, slug),
  unique (client_id, automation_key)
);
create index if not exists ignition_campaigns_client_idx on public.ignition_campaigns(client_id, state);

alter table public.ignition_campaigns enable row level security;
do $$ begin
  create policy ignition_campaigns_select on public.ignition_campaigns
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
-- Write is STAFF ONLY. Building a campaign - roster, messages, pace, consent
-- basis, dry run - is a staff surface; the owner's Sales-section tile is a window,
-- not a control. If campaign-building ever opens to owners, this policy is the seam.
do $$ begin
  create policy ignition_campaigns_write on public.ignition_campaigns
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.ignition_campaigns is
  'One reignition campaign: a hand-built roster of old leads, a paced admission rate, and a written consent basis. The messages live in automations (automation_key ignition:<slug>) and ride the ordinary send path - this table never sends anything.';
comment on column public.ignition_campaigns.consent_basis is
  'REQUIRED, human-written: where these leads came from and why we may message them. Positive consent is not recorded anywhere in this system (only dnd / email_suppressions, both opt-OUT), so no automated check can stand in for this.';
comment on column public.ignition_campaigns.per_day is
  'ADMISSION rate: how many roster rows enter the stage + the automation per day. Never a send rate - once admitted, a person''s steps follow the sequence''s own waits on the ordinary worker.';

-- 2. ignition_roster ----------------------------------------------------------
-- One row per person on one campaign. This IS the door: the reignition stage has
-- no form source, no calendar source and no automatic trigger, so a row here is
-- the only way anybody ever enters it.
create table if not exists public.ignition_roster (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.ignition_campaigns(id) on delete cascade,
  -- Denormalised for RLS + the per-academy indexes; always equals the campaign's.
  client_id     uuid not null references public.clients(id) on delete cascade,

  -- The contact, on the same bridge every other table uses (ghl_contact_id /
  -- automation_enrollments.contact_id), so the joins already work.
  contact_id    text not null,
  contact_name  text,

  -- queued        on the roster, not yet admitted. Halting leaves them here forever.
  -- admitted      in the stage and enrolled; their steps are on the ordinary worker.
  -- replied       they answered; the campaign ended for them and they left the stage.
  -- ran_out       the sequence finished in silence; handed to the long game.
  -- halted        the campaign was halted before they were ever admitted.
  -- excluded      a rail refused them (reason in excluded_reason). Never messaged.
  --
  -- THERE IS DELIBERATELY NO `sent_step_N` STATE. An earlier draft had one and it
  -- would have been a second copy of a fact the automation engine already owns:
  -- which step a person is on is automation_enrollments.current_position, and when
  -- the next one fires is the earliest pending automation_jobs.run_after. Writing
  -- it here would mean writing it from the send path (which must not know about
  -- campaigns) and it would disagree with the engine the first time a step was
  -- skipped, disabled, deferred for quiet hours, or retried. The roster view joins
  -- those two tables live instead - api/reignition.js `get`.
  state         text not null default 'queued'
                  check (state in ('queued','admitted','replied','ran_out','halted','excluded')),
  excluded_reason text,

  -- Set when the cron admits them. NULL means nothing has ever been sent to them
  -- on this campaign, which is the only claim halt has to make.
  admitted_at   timestamptz,
  -- The automation enrollment created at admission, so the roster view can show
  -- which step they are on and when the next one fires without a second source.
  enrollment_id uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The same person can be on a LATER campaign again (repeat visitors are allowed
  -- by design), but never twice on the same one.
  unique (campaign_id, contact_id)
);
create index if not exists ignition_roster_campaign_idx on public.ignition_roster(campaign_id, state);
create index if not exists ignition_roster_client_idx   on public.ignition_roster(client_id, contact_id);
create index if not exists ignition_roster_admitted_idx on public.ignition_roster(campaign_id, admitted_at);

alter table public.ignition_roster enable row level security;
do $$ begin
  create policy ignition_roster_select on public.ignition_roster
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy ignition_roster_write on public.ignition_roster
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.ignition_roster is
  'Who is on a reignition campaign and where they are in it. A row here is the ONLY way into the reignition stage - it has no form source, no calendar source and no automatic trigger. admitted_at NULL means nothing has ever been sent to this person on this campaign. Which STEP an admitted person is on is not stored here: it is read live from automation_enrollments.current_position.';

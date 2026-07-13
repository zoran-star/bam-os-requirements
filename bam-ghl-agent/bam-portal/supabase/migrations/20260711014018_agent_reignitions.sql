-- 🔥 REIGNITION (Zoran 2026-07-10): a lead in ANY agent-governed stage who says
-- "yes, but later / after summer / call me in September" gets PARKED where they
-- are, with a pre-written re-engagement message that surfaces as a Hawkeye card
-- in the SAME agent's deck tab when the date arrives.
--
-- Model:
--   1. The agent detects the intent (reignite_at + reignite_message on
--      propose_reply) OR staff picks "Reignite later" on any deck card.
--      A kind='reignite' card queues: an editable ack to send now + the editable
--      future message + the date. Approving it = send ack + write a row here.
--   2. This table is the park. The lead STAYS in their current stage; proactive
--      detector passes skip anyone with a scheduled reignition.
--   3. Each agent's detect cron fires due rows into a kind='reignite_due' card
--      (draft = the pre-written message) and marks the row 'carded'; approving
--      that card sends it via the normal send path ('done').
--   4. Auto-cancel: a real inbound reply, a booking, an enroll, a lost /
--      unqualified / ghosted move, or leaving the agent's stage cancels the
--      scheduled reignition (cancel_reason says why).

create table if not exists public.agent_reignitions (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id  text not null,
  contact_name    text,
  agent           text not null check (agent in ('booking','confirm','closing')),
  reignite_at     timestamptz not null,        -- when the re-engagement card should fire
  message         text not null,               -- the pre-written re-engagement draft (locked at park time, editable then)
  reason          text,                        -- why parked ("wants to start after summer")
  source          text not null default 'agent' check (source in ('agent','manual')),
  status          text not null default 'scheduled'
    check (status in ('scheduled','carded','done','canceled')),
  cancel_reason   text,
  carded_at       timestamptz,
  done_at         timestamptz,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One scheduled reignition per contact per academy (a new park replaces the old
-- one via cancel-then-insert in the API, never a silent duplicate).
create unique index if not exists agent_reignitions_one_scheduled
  on public.agent_reignitions (client_id, ghl_contact_id)
  where status = 'scheduled';

-- The detectors' due-scan + the deck's badge list.
create index if not exists agent_reignitions_due_idx
  on public.agent_reignitions (client_id, agent, status, reignite_at);
create index if not exists agent_reignitions_contact_idx
  on public.agent_reignitions (client_id, ghl_contact_id);

alter table public.agent_reignitions enable row level security;

-- Staff or a member of the academy can read; all writes go through the
-- service-role agent APIs, which enforce the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_reignitions' and policyname='agent_reignitions_select') then
    create policy agent_reignitions_select on public.agent_reignitions for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_reignitions is
  'Parked "yes, but later" leads. The lead stays in their current stage; the owning agent''s detect cron fires the pre-written message as a Hawkeye card at reignite_at. Real inbound / booking / enroll / lost / unqualified / leaving the stage auto-cancels.';

-- The park + fired cards ride the agents' own queues:
--   kind='reignite'     → the PARK card (ack now + future message + date, human ✓)
--   kind='reignite_due' → the fired card at the date (draft = the parked message)
-- reignite_at/reignite_message carry the structured fields on the park card;
-- reignite_at is kept on the fired card for display.

alter table public.agent_ready_replies
  add column if not exists reignite_at      timestamptz,
  add column if not exists reignite_message text;

alter table public.agent_confirm_replies
  add column if not exists reignite_at      timestamptz,
  add column if not exists reignite_message text;

alter table public.agent_closing_replies
  add column if not exists reignite_at      timestamptz,
  add column if not exists reignite_message text;

-- Widen the confirm/closing kind CHECKs (agent_ready_replies has no kind CHECK).
alter table public.agent_confirm_replies
  drop constraint if exists agent_confirm_replies_kind_check;
alter table public.agent_confirm_replies
  add constraint agent_confirm_replies_kind_check
  check (kind in ('confirm','confirm_handoff','confirm_lost','confirm_auto','reignite','reignite_due'));

alter table public.agent_closing_replies
  drop constraint if exists agent_closing_replies_kind_check;
alter table public.agent_closing_replies
  add constraint agent_closing_replies_kind_check
  check (kind in ('closing','closing_enroll','closing_lost','closing_auto','reignite','reignite_due'));

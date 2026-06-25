-- Confirm agent queue: the SECOND sales agent. It works leads in the Training
-- pipeline's "Scheduled Trial" (a.k.a. "Booked Trial") stage — AFTER the booking
-- agent has booked them. Its job is to confirm attendance, help them get to the
-- trial, and on "I can't make it" hand them back to the booking agent to rebook.
--
-- Deliberately a SEPARATE table from agent_ready_replies (the booking queue) so the
-- two agents never touch each other's cards: the booking detector's prune/flush
-- sweeps agent_ready_replies broadly, and folding confirm cards in there would let
-- it cancel/flush them by mistake. Same shape as agent_ready_replies minus the
-- booking-slot columns, plus a handoff_note (the context the booking agent reads
-- when this card hands a lead back to rebook).
--
--   kind='confirm'          → a drafted confirm/logistics reply to send
--   kind='confirm_handoff'  → the lead can't make it; on ✓ we write a context note
--                             and bounce them Scheduled-Trial → Responded so the
--                             booking agent rebooks. NEVER auto-executes.
--   kind='confirm_lost'     → the lead no longer wants the trial at all; on ✓ mark
--                             the opportunity Lost. NEVER auto-executes.

create table if not exists public.agent_confirm_replies (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id       text not null,
  ghl_conversation_id  text,
  contact_name         text,
  kind                 text not null default 'confirm'
    check (kind in ('confirm','confirm_handoff','confirm_lost')),
  draft_message        text,                       -- the confirm/logistics reply (or warm closing on handoff/lost)
  reasoning            text,
  confidence           numeric,                    -- 0..1 (self-drive auto-sends 'confirm' above the threshold)
  escalate             boolean default false,
  escalate_reason      text,
  handoff_note         text,                       -- context the booking agent reads on a handoff
  lost_reason          text,                       -- decline category on confirm_lost
  trial_at             timestamptz,                -- the booked trial slot at draft time (display)
  reply_count          integer,
  last_lead_at         timestamptz,                -- lead's last inbound at draft time (dedupe)
  last_message         text,
  last_outbound        text,
  summary              text,
  thread_tail          jsonb,
  status               text not null default 'pending'
    check (status in ('pending','approved','sent','skipped','canceled','failed')),
  send_after           timestamptz,                -- quiet-hours hold
  send_error           text,
  auto_sent            boolean default false,
  approved_by          text,
  approved_at          timestamptz,
  sent_at              timestamptz,
  created_by           text default 'detector',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One active (pending or approved) confirm card per contact per academy.
create unique index if not exists agent_confirm_replies_one_active_per_contact
  on public.agent_confirm_replies (client_id, ghl_contact_id)
  where status in ('pending','approved');

create index if not exists agent_confirm_replies_open_idx
  on public.agent_confirm_replies (client_id, status);

create index if not exists agent_confirm_replies_contact_idx
  on public.agent_confirm_replies (client_id, ghl_contact_id);

create index if not exists agent_confirm_replies_send_after_idx
  on public.agent_confirm_replies (status, send_after)
  where send_after is not null;

alter table public.agent_confirm_replies enable row level security;

-- Staff (or a member of the academy) can read; all writes go through the
-- service-role API (api/agent-confirm.js), which enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_confirm_replies' and policyname='agent_confirm_replies_select') then
    create policy agent_confirm_replies_select on public.agent_confirm_replies for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_confirm_replies is
  'Confirm agent queue (Scheduled-Trial stage): drafted confirmation/logistics replies, plus handoff (back to Responded for rebooking) and lost proposals. Separate from agent_ready_replies so the booking detector never touches these cards.';

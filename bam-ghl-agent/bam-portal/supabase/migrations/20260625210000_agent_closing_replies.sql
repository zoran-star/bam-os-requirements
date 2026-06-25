-- Closing agent queue: the THIRD sales agent. It works leads in the Training
-- pipeline's "Done Trial" (a.k.a. "Attended" / "Trial Complete") stage — AFTER the
-- coach's post-trial form marked the athlete showed-up + good fit. Its job is to
-- convert that good-fit attendee into a PAYING MEMBER: a warm post-trial follow-up,
-- objection handling, and the close = sending the academy's enrollment (sign-up) link.
--
-- Deliberately a SEPARATE table from agent_ready_replies (booking) and
-- agent_confirm_replies (confirm) so the three agents never touch each other's
-- cards. Same shape as agent_confirm_replies minus handoff_note, plus enroll_note
-- (context captured when the agent proposes sending the enrollment link).
--
--   kind='closing'         → a drafted closing/nurture reply to send
--   kind='closing_enroll'  → the lead is ready to enroll; on ✓ we send the sign-up
--                            link and mark the opportunity won. NEVER auto-executes.
--   kind='closing_lost'    → the good-fit attendee won't enroll; on ✓ mark the
--                            opportunity Lost. NEVER auto-executes.

create table if not exists public.agent_closing_replies (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id       text not null,
  ghl_conversation_id  text,
  contact_name         text,
  kind                 text not null default 'closing'
    check (kind in ('closing','closing_enroll','closing_lost')),
  draft_message        text,                       -- the closing/nurture reply (or warm closing on enroll/lost)
  reasoning            text,
  confidence           numeric,                    -- 0..1 (self-drive auto-sends 'closing' above the threshold)
  escalate             boolean default false,
  escalate_reason      text,
  enroll_note          text,                       -- context captured when proposing the enrollment link
  lost_reason          text,                       -- decline category on closing_lost
  trial_at             timestamptz,                -- the lead's trial slot at draft time (display)
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

-- One active (pending or approved) closing card per contact per academy.
create unique index if not exists agent_closing_replies_one_active_per_contact
  on public.agent_closing_replies (client_id, ghl_contact_id)
  where status in ('pending','approved');

create index if not exists agent_closing_replies_open_idx
  on public.agent_closing_replies (client_id, status);

create index if not exists agent_closing_replies_contact_idx
  on public.agent_closing_replies (client_id, ghl_contact_id);

create index if not exists agent_closing_replies_send_after_idx
  on public.agent_closing_replies (status, send_after)
  where send_after is not null;

alter table public.agent_closing_replies enable row level security;

-- Staff (or a member of the academy) can read; all writes go through the
-- service-role API (api/agent-closing.js), which enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_closing_replies' and policyname='agent_closing_replies_select') then
    create policy agent_closing_replies_select on public.agent_closing_replies for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_closing_replies is
  'Closing agent queue (Done-Trial stage): drafted post-trial conversion replies, plus enroll (send the sign-up link + mark won) and lost proposals. Separate from agent_ready_replies / agent_confirm_replies so each detector only touches its own cards.';

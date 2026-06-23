-- Ready replies: the agent pre-drafts the next reply for a lead in the Responded
-- stage (they just replied, waiting on us) and queues it. In Hawkeye mode a human
-- approves/edits before it sends; in Self-drive a high-confidence draft sends
-- itself and only the unsure ones land here for approval.
--
-- Sibling of agent_followups (scheduled nudges). Together they feed the client
-- portal's unified approval inbox (Inbox → 📨 Approve). agent_approvals stays the
-- after-the-fact audit log; this table is the live queue.

create table if not exists public.agent_ready_replies (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id       text not null,
  ghl_conversation_id  text,
  contact_name         text,
  draft_message        text not null,              -- the pre-drafted reply (editable before send)
  reasoning            text,                       -- 1-2 line why / convo state
  confidence           numeric,                    -- 0..1 (self-drive auto-sends above the threshold)
  asked_to_book        boolean default false,
  escalate             boolean default false,      -- brain wants a human → always lands in the inbox
  escalate_reason      text,
  reply_count          integer,                    -- how many times we've replied already
  booking_asks         integer,                    -- how many of those asked them to book
  last_lead_at         timestamptz,                -- lead's last inbound at draft time (dedupe new replies)
  status               text not null default 'pending'
    check (status in ('pending','approved','sent','skipped','canceled','failed')),
  send_error           text,
  auto_sent            boolean default false,      -- true if self-drive sent it without a human
  approved_by          text,
  approved_at          timestamptz,
  sent_at              timestamptz,
  created_by           text default 'detector',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One active (pending or approved) ready reply per contact per academy — the
-- detector checks this before drafting, and it hard-stops accidental dupes.
create unique index if not exists agent_ready_replies_one_active_per_contact
  on public.agent_ready_replies (client_id, ghl_contact_id)
  where status in ('pending','approved');

-- Inbox lookup: open items for an academy.
create index if not exists agent_ready_replies_open_idx
  on public.agent_ready_replies (client_id, status);

-- Cancel-on-reply / "did we already answer this inbound" lookup.
create index if not exists agent_ready_replies_contact_idx
  on public.agent_ready_replies (client_id, ghl_contact_id);

alter table public.agent_ready_replies enable row level security;

-- Staff (or a member of the academy) can read; all writes go through the
-- service-role API (api/agent-approvals.js), which enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_ready_replies' and policyname='agent_ready_replies_select') then
    create policy agent_ready_replies_select on public.agent_ready_replies for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_ready_replies is
  'Pre-drafted agent replies for Responded-stage leads who just messaged. Detector drafts (status=pending); Hawkeye = human approves in the inbox; Self-drive auto-sends high-confidence drafts (auto_sent=true) and queues the rest. inbound-reply webhook cancels pending/approved when the lead messages again.';

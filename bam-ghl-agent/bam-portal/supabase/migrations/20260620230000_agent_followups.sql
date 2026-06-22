-- Scheduled follow-ups: the agent pre-drafts the next nudge for a quiet lead and
-- puts it on a timeline. A human approves/edits before it auto-sends at its time.
-- (Approve-each: the worker only sends rows that reach status='approved'.)

create table if not exists public.agent_followups (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id       text not null,
  ghl_conversation_id  text,
  contact_name         text,
  goal                 text,                       -- one-line: the goal of this follow-up / convo state
  draft_message        text not null,              -- the pre-drafted nudge (editable before send)
  scheduled_at         timestamptz not null,       -- when it should fire
  status               text not null default 'pending'
    check (status in ('pending','approved','sent','skipped','canceled','failed')),
  trigger_reason       text,                       -- why it was scheduled (AI reason / which trigger)
  last_lead_at         timestamptz,                -- lead's last activity at draft time (detect new replies)
  confidence           numeric,
  approved_by          text,
  approved_at          timestamptz,
  sent_at              timestamptz,
  send_error           text,
  created_by           text default 'detector',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One active (pending or approved) follow-up per contact per academy — the
-- detector checks this before drafting, and it hard-stops accidental dupes.
create unique index if not exists agent_followups_one_active_per_contact
  on public.agent_followups (client_id, ghl_contact_id)
  where status in ('pending','approved');

-- Worker scan: approved rows whose time has come.
create index if not exists agent_followups_due_idx
  on public.agent_followups (scheduled_at)
  where status = 'approved';

-- Cancel-on-reply lookup.
create index if not exists agent_followups_contact_idx
  on public.agent_followups (client_id, ghl_contact_id);

alter table public.agent_followups enable row level security;

-- Staff (or a member of the academy) can read; all writes go through the
-- service-role API (api/agent-followups.js), which enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_followups' and policyname='agent_followups_select') then
    create policy agent_followups_select on public.agent_followups for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_followups is
  'Scheduled agent follow-up nudges for quiet leads. Detector drafts (status=pending); admin approves (approved); per-minute worker sends due approved rows via GHL; inbound-reply webhook cancels pending/approved for a contact the moment they reply.';

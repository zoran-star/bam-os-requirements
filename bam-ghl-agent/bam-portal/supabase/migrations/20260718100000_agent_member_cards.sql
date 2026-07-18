-- Member Care agent cards: the agent watches a MEMBER's parent conversation and
-- PROPOSES up to three things on one card - (1) a billing/member action (pause,
-- cancel, plan change, payment link), (2) a draft reply back to the parent, and
-- (3) staff to-dos. Nothing ever executes or sends on its own: each part has its
-- own status and its own approve button in the member drawer (client portal).
--
-- Sibling of agent_ready_replies / agent_confirm_replies / agent_closing_replies,
-- but keyed on the MEMBERS roster (members.id), not pipeline leads. The detector
-- (api/agent-member-care.js) drafts on cron + the inbound webhooks fast-path;
-- approval fires the proven PATCH /api/members and /api/ghl/send-message paths.

create table if not exists public.agent_member_cards (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  member_id           uuid not null references public.members(id) on delete cascade,
  ghl_contact_id      text not null,
  member_name         text,                 -- athlete, for the card header
  parent_name         text,

  -- Part 1: proposed member action (null action = card has no action part).
  -- `action` is the EXACT api/members.js action string; `action_body` is the
  -- PATCH /api/members body the Confirm button fires (server re-authorizes).
  action              text,
  action_body         jsonb,
  action_summary      text,                 -- server-built human line ("Pause Tristan: ...")
  action_status       text not null default 'none'
    check (action_status in ('none','pending','done','dismissed','failed')),
  action_done_by      text,
  action_done_at      timestamptz,

  -- Part 2: draft reply to the parent (editable before send; goes out via
  -- /api/ghl/send-message only when a human clicks Send).
  draft_reply         text,
  reply_channel       text check (reply_channel in ('SMS','Email')),
  reply_status        text not null default 'none'
    check (reply_status in ('none','pending','sent','dismissed','failed')),
  reply_sent_by       text,
  reply_sent_at       timestamptz,

  -- Part 3: staff to-dos - array of { title, notes }. "Add to to-dos" copies
  -- them into action_items; tracked only, never executed.
  action_items        jsonb,
  action_items_status text not null default 'none'
    check (action_items_status in ('none','pending','added','dismissed')),

  -- Shared agent metadata (mirrors agent_ready_replies)
  reasoning           text,
  confidence          numeric,
  escalate            boolean default false,
  escalate_reason     text,
  summary             text,                 -- 2-3 sentence story of the convo for the reviewer
  thread_tail         jsonb,                -- last ~6 messages snapshot (teach-why training signal)
  last_message        text,
  last_inbound_at     timestamptz,          -- parent's last inbound at draft time (dedup key)

  status              text not null default 'pending'
    check (status in ('pending','resolved','canceled','failed')),
  resolve_note        text,                 -- why canceled/resolved ("parent replied again", ...)
  created_by          text default 'detector',   -- detector | webhook-fastpath
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One ACTIVE card per member per academy - the detector checks before drafting,
-- and this hard-stops accidental dupes (same guard as agent_ready_replies).
create unique index if not exists agent_member_cards_one_active_per_member
  on public.agent_member_cards (client_id, member_id)
  where status = 'pending';

-- Drawer/queue lookup: open cards for an academy.
create index if not exists agent_member_cards_open_idx
  on public.agent_member_cards (client_id, status);

-- Webhook cancel-on-reply / dedup lookup by contact.
create index if not exists agent_member_cards_contact_idx
  on public.agent_member_cards (client_id, ghl_contact_id);

alter table public.agent_member_cards enable row level security;

-- Staff (or a member of the academy) can read; all writes go through the
-- service-role API (api/agent-member-care.js), which enforces the rules.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='agent_member_cards' and policyname='agent_member_cards_select') then
    create policy agent_member_cards_select on public.agent_member_cards for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

comment on table public.agent_member_cards is
  'Member Care agent proposals: per-member cards carrying an optional billing action, an optional draft reply to the parent, and optional staff to-dos - each part independently approved/dismissed by a human in the member drawer. Detector drafts (status=pending); the inbound webhooks cancel + redraft when the parent messages again. Nothing auto-executes.';

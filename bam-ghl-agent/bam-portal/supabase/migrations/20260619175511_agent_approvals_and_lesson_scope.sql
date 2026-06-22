-- Log of bot-drafted replies that a human approved/adjusted + sent, for the
-- "responded" stage free-trial booking agent. The live queue is computed from
-- GHL (responded-stage contacts whose last message is inbound); this table is
-- the audit/analytics record of what the bot proposed vs what went out.
create table if not exists public.agent_approvals (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references public.clients(id) on delete cascade,
  ghl_contact_id       text,
  ghl_conversation_id  text,
  contact_name         text,
  suggested_reply      text,
  final_reply          text,
  reasoning            text,
  confidence           numeric,
  reply_count          int,
  booking_asks         int,
  adjusted             boolean not null default false,
  status               text not null default 'sent',  -- 'sent' | 'skipped'
  lesson_id            uuid,
  created_by           text,
  created_at           timestamptz not null default now()
);
create index if not exists agent_approvals_client_idx on public.agent_approvals(client_id, created_at desc);
alter table public.agent_approvals enable row level security;
create policy agent_approvals_select on public.agent_approvals
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy agent_approvals_write on public.agent_approvals
  for all using (is_staff()) with check (is_staff());

-- Learnings scope: 'academy' = stays with this academy (offer/pricing/local —
-- NEVER auto-promoted); 'general' = sales-craft eligible for promotion to the
-- shared brain. Default academy (born local).
alter table public.agent_lessons add column if not exists scope text not null default 'academy';

comment on table public.agent_approvals is
  'Audit of bot-drafted replies (responded-stage free-trial booking agent) that a human approved/adjusted and sent.';
comment on column public.agent_lessons.scope is
  'academy = local to this academy, never auto-promoted (offer/pricing/local facts); general = sales-craft, promotable to shared brain by BAM staff.';;

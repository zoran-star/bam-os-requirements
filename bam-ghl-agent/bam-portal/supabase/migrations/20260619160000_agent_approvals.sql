-- Bot approval queue (responded-stage free-trial booking agent). The live queue
-- is computed from GHL; this table is the audit of what the bot proposed vs what
-- a human approved/adjusted + sent. Plus a `scope` flag on lessons so academy-
-- specific learnings stay local. (Applied via Supabase MCP 2026-06-19.)
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
  status               text not null default 'sent',
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

alter table public.agent_lessons add column if not exists scope text not null default 'academy';

comment on table public.agent_approvals is
  'Audit of bot-drafted replies (responded-stage free-trial booking agent) approved/adjusted and sent by a human.';
comment on column public.agent_lessons.scope is
  'academy = local to this academy, never auto-promoted; general = sales-craft, promotable to the shared brain by BAM staff.';

-- Track 2 rail core (P3): the greenfield V2 ticket system. V1/V1.5 legacy
-- `tickets` / `marketing_tickets` / `content_tickets` are UNTOUCHED - V2
-- academies ride this rail. Design: docs/zoran-icon-ticket-design.md
-- "T-SCOPE OUTCOME". Notifications (Slack channels + client SMS) are wired
-- later (P6); every mutation flows through api/v2-tickets.js so there is one
-- hook point.

create table if not exists public.v2_tickets (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  type             text not null check (type in (
                     'fix','website_change','billing_fix','data_fix',   -- systems family
                     'agent_correction',                                -- agent supervision
                     'marketing_ask','content_ask',                     -- marketing / content
                     'build_ask','feature_idea','general')),            -- build / backlog / chat
  status           text not null default 'new' check (status in
                     ('new','in_progress','waiting_client','resolved','closed')),
  assignee_role    text not null check (assignee_role in
                     ('systems','agent_supervision','marketing','content','backlog')),
  assigned_to      uuid references public.staff(id) on delete set null,
  title            text not null default '',
  created_by       uuid references public.client_users(id) on delete set null,
  created_by_staff uuid references public.staff(id) on delete set null,
  source           text not null check (source in
                     ('icon-chat','inbox-flag','editor','import','billing','staff','offer-flow')),
  intake           jsonb not null default '{}'::jsonb,
  context          jsonb not null default '{}'::jsonb,
  close_reason     text,
  legacy_feedback_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  closed_at        timestamptz
);
create index if not exists v2_tickets_client_status_idx on public.v2_tickets(client_id, status);
create index if not exists v2_tickets_role_open_idx on public.v2_tickets(assignee_role, status)
  where status not in ('resolved','closed');

comment on table public.v2_tickets is
  'V2 greenfield ticket rail (Track 2). Type -> assignee_role mapped server-side in api/v2-tickets.js. Slack channel is f(type,source) at notify time, not stored.';

create table if not exists public.v2_ticket_messages (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.v2_tickets(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,  -- denormalized for RLS
  author_kind   text not null check (author_kind in ('client','staff','agent','system')),
  author_client_user_id uuid references public.client_users(id) on delete set null,
  author_staff_id       uuid references public.staff(id) on delete set null,
  author_name   text not null default '',
  body          text not null default '',
  attachments   jsonb not null default '[]'::jsonb,
  internal      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists v2_ticket_messages_ticket_idx on public.v2_ticket_messages(ticket_id, created_at);

comment on table public.v2_ticket_messages is
  'The real conversation thread per v2_ticket (client + staff + agent). author_kind=system rows double as the status log.';

-- RLS (house pattern). Client status moves happen through the API (service
-- role), so clients get SELECT/INSERT but not UPDATE on tickets. Replies live
-- in messages.
alter table public.v2_tickets enable row level security;
create policy v2t_staff_all on public.v2_tickets for all using (is_staff()) with check (is_staff());
create policy v2t_client_select on public.v2_tickets for select using (client_id in (select my_client_ids()));
create policy v2t_client_insert on public.v2_tickets for insert with check (client_id in (select my_client_ids()));

alter table public.v2_ticket_messages enable row level security;
create policy v2m_staff_all on public.v2_ticket_messages for all using (is_staff()) with check (is_staff());
create policy v2m_client_select on public.v2_ticket_messages
  for select using (client_id in (select my_client_ids()) and internal = false);
create policy v2m_client_insert on public.v2_ticket_messages
  for insert with check (client_id in (select my_client_ids()) and author_kind = 'client' and internal = false);

-- touch v2_tickets.updated_at whenever a message lands
create or replace function public.v2_touch_ticket() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.v2_tickets set updated_at = now() where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists v2_msg_touch on public.v2_ticket_messages;
create trigger v2_msg_touch after insert on public.v2_ticket_messages
  for each row execute function public.v2_touch_ticket();

-- realtime
alter publication supabase_realtime add table public.v2_tickets;
alter publication supabase_realtime add table public.v2_ticket_messages;

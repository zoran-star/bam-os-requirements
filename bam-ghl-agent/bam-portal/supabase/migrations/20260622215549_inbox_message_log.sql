-- Audit log of every message sent from the portal inbox, with GHL's confirmation
-- (ghl_message_id) on success or the error on failure. Hard proof a reply saved
-- to GHL, and a trail to debug any "did it send?" question.
create table if not exists public.inbox_message_log (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id       text,
  ghl_conversation_id  text,
  ghl_message_id       text,          -- GHL's confirmation id on success
  channel              text,          -- SMS / Email
  message              text,          -- truncated body
  status               text not null, -- 'sent' | 'failed'
  error                text,
  sent_by              text,          -- user email
  created_at           timestamptz not null default now()
);
create index if not exists inbox_message_log_client_idx on public.inbox_message_log (client_id, created_at desc);
alter table public.inbox_message_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='inbox_message_log' and policyname='inbox_message_log_select') then
    create policy inbox_message_log_select on public.inbox_message_log for select
      using (is_staff() or client_id in (select my_client_ids()));
  end if;
end $$;

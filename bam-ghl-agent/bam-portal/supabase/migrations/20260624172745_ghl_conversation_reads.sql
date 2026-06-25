-- Per-user read state for the GHL-backed inbox (V1.5 / V2). GHL has no reliable
-- "mark conversation read" API, so the portal tracks it locally (mirrors the
-- staff inbox's conversation_reads). A conversation is unread for a user when its
-- last message is newer than that user's last_read_at (computed in api/ghl/inbox.js).
create table if not exists public.ghl_conversation_reads (
  client_id            uuid        not null references public.clients(id) on delete cascade,
  ghl_conversation_id  text        not null,
  auth_user_id         uuid        not null,
  last_read_at         timestamptz not null default now(),
  primary key (auth_user_id, ghl_conversation_id)
);

create index if not exists ghl_conversation_reads_client_user_idx
  on public.ghl_conversation_reads (client_id, auth_user_id);

alter table public.ghl_conversation_reads enable row level security;

-- The API uses the service role (bypasses RLS); this policy is defense-in-depth
-- so a user can only ever see/touch their own read rows.
drop policy if exists ghl_conversation_reads_own on public.ghl_conversation_reads;
create policy ghl_conversation_reads_own on public.ghl_conversation_reads
  for all using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

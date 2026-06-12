-- Rewrite every client-scoped RLS policy from the single-owner model
-- (clients.auth_user_id = auth.uid()) to the multi-user membership model
-- (client_id IN my_client_ids()). Atomic: all-or-nothing in one transaction.

-- ── clients ───────────────────────────────────────────────────────────────
drop policy if exists "client read own client row" on public.clients;
create policy "client read own client row" on public.clients
  for select to authenticated
  using (id in (select public.my_client_ids()));

-- ── tickets ───────────────────────────────────────────────────────────────
drop policy if exists "client read own tickets" on public.tickets;
create policy "client read own tickets" on public.tickets
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "client insert own tickets" on public.tickets;
create policy "client insert own tickets" on public.tickets
  for insert to authenticated
  with check (client_id in (select public.my_client_ids()));

drop policy if exists "client update own ticket messages" on public.tickets;
create policy "client update own ticket messages" on public.tickets
  for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

-- ── marketing_tickets ─────────────────────────────────────────────────────
drop policy if exists "Client read own marketing tickets" on public.marketing_tickets;
create policy "Client read own marketing tickets" on public.marketing_tickets
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "Client insert own marketing tickets" on public.marketing_tickets;
create policy "Client insert own marketing tickets" on public.marketing_tickets
  for insert to authenticated
  with check (client_id in (select public.my_client_ids()));

drop policy if exists "Client update own marketing tickets" on public.marketing_tickets;
create policy "Client update own marketing tickets" on public.marketing_tickets
  for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

-- ── content_tickets ───────────────────────────────────────────────────────
drop policy if exists "Client read own content tickets" on public.content_tickets;
create policy "Client read own content tickets" on public.content_tickets
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "Client insert own content tickets" on public.content_tickets;
create policy "Client insert own content tickets" on public.content_tickets
  for insert to authenticated
  with check (client_id in (select public.my_client_ids()));

drop policy if exists "Client update own content tickets" on public.content_tickets;
create policy "Client update own content tickets" on public.content_tickets
  for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

-- ── conversations ─────────────────────────────────────────────────────────
drop policy if exists "clients_read_own_conversations" on public.conversations;
create policy "clients_read_own_conversations" on public.conversations
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- ── conversation_messages ─────────────────────────────────────────────────
drop policy if exists "clients_read_own_messages" on public.conversation_messages;
create policy "clients_read_own_messages" on public.conversation_messages
  for select to authenticated
  using (conversation_id in (
    select c.id from public.conversations c
    where c.client_id in (select public.my_client_ids())
  ));

-- ── client_meta_tokens ────────────────────────────────────────────────────
drop policy if exists "client reads own meta token" on public.client_meta_tokens;
create policy "client reads own meta token" on public.client_meta_tokens
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- ── client_users (the new Team table) ─────────────────────────────────────
-- A portal user can read every membership row for any client they belong to
-- (so the Team list renders). Recursion-safe: my_client_ids() is SECURITY DEFINER.
drop policy if exists "Owners can read own row" on public.client_users;
drop policy if exists "client_users_member_select" on public.client_users;
create policy "client_users_member_select" on public.client_users
  for select to authenticated
  using (client_id in (select public.my_client_ids()));;

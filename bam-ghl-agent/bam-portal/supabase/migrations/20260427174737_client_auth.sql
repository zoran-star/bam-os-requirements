-- 1. Link clients to Supabase auth users
alter table clients add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
create index if not exists clients_auth_user_id_idx on clients (auth_user_id);

-- 2. Harden tickets RLS — drop the broad anon-read policy
drop policy if exists "Clients can read own tickets" on tickets;
drop policy if exists "Clients can submit tickets" on tickets;

-- 3. New per-client read policy (only their own tickets, via auth.uid())
create policy "client read own tickets"
  on tickets for select
  to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- 4. Insert: client can submit a ticket for themselves
create policy "client insert own tickets"
  on tickets for insert
  to authenticated
  with check (client_id in (select id from clients where auth_user_id = auth.uid()));

-- 5. Update: client can update only the messages column on their own tickets
--    (broader writes — like changing status, fields — stay locked to staff)
create policy "client update own ticket messages"
  on tickets for update
  to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()))
  with check (client_id in (select id from clients where auth_user_id = auth.uid()));

-- 6. Clients table — let an authed user read their own client row
alter table clients enable row level security;
drop policy if exists "client read own client row" on clients;
create policy "client read own client row"
  on clients for select
  to authenticated
  using (auth_user_id = auth.uid());

-- 7. Staff (service-role API endpoints) bypass RLS via service-role key, so no
--    additional policies needed for them. The existing "staff_select_all_tickets"
--    + "Staff can update tickets" remain in place for staff portal direct-Supabase
--    queries (which already require Bearer auth).;

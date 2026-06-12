-- PART C: scope the wide-open "Staff" RLS policies to actual staff.
-- Before: qual = true / auth.role()='authenticated' -> any logged-in user.
-- After:  is_staff() -> only users with a row in the staff table.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid())
$$;

grant execute on function public.is_staff() to authenticated, anon;

-- ── tickets ───────────────────────────────────────────────────────────────
drop policy if exists "staff_select_all_tickets" on public.tickets;
create policy "staff_select_all_tickets" on public.tickets
  for select to authenticated
  using (public.is_staff());

drop policy if exists "Staff can update tickets" on public.tickets;
create policy "Staff can update tickets" on public.tickets
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ── clients ───────────────────────────────────────────────────────────────
drop policy if exists "Staff can read clients" on public.clients;
create policy "Staff can read clients" on public.clients
  for select to authenticated
  using (public.is_staff());

drop policy if exists "Staff can update clients" on public.clients;
create policy "Staff can update clients" on public.clients
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "Staff can insert clients" on public.clients;
create policy "Staff can insert clients" on public.clients
  for insert to authenticated
  with check (public.is_staff());

-- ── client_users ──────────────────────────────────────────────────────────
drop policy if exists "Staff can read all client users" on public.client_users;
create policy "Staff can read all client users" on public.client_users
  for select to authenticated
  using (public.is_staff());;

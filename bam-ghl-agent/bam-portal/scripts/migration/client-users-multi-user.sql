-- ─────────────────────────────────────────────────────────────────────────
-- Migration: multi-user client portal access
-- Date: 2026-05-20
-- Status: ✅ ALREADY APPLIED to live Supabase (jnojmfmpnsfmtqmwhopz) via the
--         Supabase MCP apply_migration on 2026-05-20. This file is the
--         version-controlled record. Do NOT re-run blind.
-- Purpose: move the client portal from 1 login per academy
--          (clients.auth_user_id) to many logins per academy via the
--          client_users join table. See memories/project_multi_user_portal.md.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ PART A — foundation (additive, no behavior change) ════════════════════
-- Applied as migration: client_users_multi_user_foundation

-- Drop the old one-row-per-user constraint (one auth user can own many clients)
alter table public.client_users drop constraint if exists client_users_user_id_key;

-- Extend client_users with role + status
alter table public.client_users
  add column if not exists role   text not null default 'member',
  add column if not exists status text not null default 'active';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_users_role_chk') then
    alter table public.client_users
      add constraint client_users_role_chk check (role in ('owner','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_users_status_chk') then
    alter table public.client_users
      add constraint client_users_status_chk check (status in ('active','revoked'));
  end if;
end $$;

create unique index if not exists client_users_user_client_ux
  on public.client_users(user_id, client_id);
create index if not exists client_users_client_idx on public.client_users(client_id);
create index if not exists client_users_user_idx   on public.client_users(user_id);

-- Backfill: every client with a linked owner becomes an 'owner' membership row
insert into public.client_users (user_id, client_id, name, email, role, status)
select c.auth_user_id, c.id,
       coalesce(nullif(trim(c.owner_name), ''), c.email, 'Owner'),
       c.email, 'owner', 'active'
from public.clients c
where c.auth_user_id is not null
on conflict (user_id, client_id) do nothing;

-- Helper: client_ids the current user belongs to.
-- SECURITY DEFINER bypasses RLS on client_users -> no policy recursion.
create or replace function public.my_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.client_users
  where user_id = auth.uid() and status = 'active'
$$;

grant execute on function public.my_client_ids() to authenticated, anon;


-- ══ PART B — RLS rewrite ═════════════════════════════════════════════════
-- Applied as migration: client_users_rls_multi_user
-- Rewrites every client-scoped policy from the single-owner model
-- (clients.auth_user_id = auth.uid()) to membership (client_id IN my_client_ids()).

-- clients
drop policy if exists "client read own client row" on public.clients;
create policy "client read own client row" on public.clients
  for select to authenticated
  using (id in (select public.my_client_ids()));

-- tickets
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

-- marketing_tickets
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

-- content_tickets
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

-- conversations
drop policy if exists "clients_read_own_conversations" on public.conversations;
create policy "clients_read_own_conversations" on public.conversations
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- conversation_messages
drop policy if exists "clients_read_own_messages" on public.conversation_messages;
create policy "clients_read_own_messages" on public.conversation_messages
  for select to authenticated
  using (conversation_id in (
    select c.id from public.conversations c
    where c.client_id in (select public.my_client_ids())
  ));

-- client_meta_tokens
drop policy if exists "client reads own meta token" on public.client_meta_tokens;
create policy "client reads own meta token" on public.client_meta_tokens
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- client_users (the Team table) — a portal user can read every membership
-- row for any client they belong to, so the Team list renders.
drop policy if exists "Owners can read own row" on public.client_users;
drop policy if exists "client_users_member_select" on public.client_users;
create policy "client_users_member_select" on public.client_users
  for select to authenticated
  using (client_id in (select public.my_client_ids()));


-- ══ PART C — staff RLS hardening ═════════════════════════════════════════
-- ⚠️ NOT YET APPLIED — pending Zoran's decision (see project_multi_user_portal.md).
-- The existing "Staff" policies are wide open (qual = true / auth.role() =
-- 'authenticated'), so any logged-in user can read/update ALL client data.
-- That overrides the PART B client policies. The intended fix:
--
--   create or replace function public.is_staff()
--   returns boolean language sql stable security definer set search_path=public
--   as $$ select exists (select 1 from public.staff s where s.user_id = auth.uid()) $$;
--   grant execute on function public.is_staff() to authenticated, anon;
--
--   then rewrite: tickets/staff_select_all_tickets, tickets/"Staff can update tickets",
--   clients/"Staff can read clients", clients/"Staff can update clients",
--   client_users/"Staff can read all client users"
--   -> using (public.is_staff())

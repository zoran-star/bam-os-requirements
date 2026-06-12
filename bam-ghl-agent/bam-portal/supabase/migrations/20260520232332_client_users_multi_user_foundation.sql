-- Multi-user client portal access: foundation (additive, no behavior change)

-- 0. Drop the old one-row-per-user constraint (one auth user can own many clients)
alter table public.client_users drop constraint if exists client_users_user_id_key;

-- 1. Extend client_users with role + status
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

-- 2. Backfill: every client with a linked owner becomes an 'owner' membership row
insert into public.client_users (user_id, client_id, name, email, role, status)
select c.auth_user_id, c.id,
       coalesce(nullif(trim(c.owner_name), ''), c.email, 'Owner'),
       c.email, 'owner', 'active'
from public.clients c
where c.auth_user_id is not null
on conflict (user_id, client_id) do nothing;

-- 3. Helper: client_ids the current user belongs to.
--    SECURITY DEFINER bypasses RLS on client_users -> no policy recursion.
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

grant execute on function public.my_client_ids() to authenticated, anon;;

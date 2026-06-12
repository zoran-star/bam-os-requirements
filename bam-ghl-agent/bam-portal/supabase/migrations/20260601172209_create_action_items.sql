-- Action Items (v1): a shared to-do list per client, visible to the academy
-- team (client portal) and BAM staff (staff portal). Any field on any row can
-- be edited by anyone who can see it. Done = completed_at IS NOT NULL.
create table if not exists public.action_items (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  title             text not null,
  description       text,
  due_date          date,
  -- Assignee is an academy teammate (client_users row). NULL = unassigned.
  -- Staff assignees come later. assignee_name is denormalized for display so
  -- the list needs no join; it's re-stamped whenever the assignee changes.
  assignee_id       uuid references public.client_users(id) on delete set null,
  assignee_name     text,
  completed_at      timestamptz,
  completed_by_name text,
  created_by        uuid,                 -- auth.users id of creator
  created_by_name   text,
  created_by_role   text check (created_by_role in ('client','staff')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Slack due-soon reminder bookkeeping (cron fires once per item per due date)
  due_soon_notified_at timestamptz
);

create index if not exists action_items_client_id_idx on public.action_items (client_id);
create index if not exists action_items_open_due_idx
  on public.action_items (client_id, completed_at, due_date);

-- keep updated_at fresh
create or replace function public.touch_action_items_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_action_items_updated_at on public.action_items;
create trigger trg_action_items_updated_at
  before update on public.action_items
  for each row execute function public.touch_action_items_updated_at();

-- RLS: staff see all; academy teammates see only their client's rows.
-- Mirrors the policy pattern used by tickets/pricing (is_staff() + my_client_ids()).
-- The serverless API uses the service role and bypasses RLS; these policies are
-- defense-in-depth for any direct (authenticated) access.
alter table public.action_items enable row level security;

drop policy if exists action_items_rw on public.action_items;
create policy action_items_rw on public.action_items
  for all to authenticated
  using (public.is_staff() or client_id in (select public.my_client_ids()))
  with check (public.is_staff() or client_id in (select public.my_client_ids()));;

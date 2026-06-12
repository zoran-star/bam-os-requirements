-- ────────────────────────────────────────────────────────────
-- marketing_tickets: client requests about ad campaigns
-- (replace creative, add creative, remove creative, budget change,
--  full campaign creation). Mirrors the existing `tickets` shape.
-- ────────────────────────────────────────────────────────────
create table public.marketing_tickets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,

  -- Type and lifecycle
  type text not null
    check (type in ('replace','add','remove','budget','campaign-create')),
  status text not null default 'in-progress'
    check (status in ('in-progress','completed','cancelled')),
  content_check_status text not null default 'not-required'
    check (content_check_status in ('not-required','pending','approved')),
  client_action_status text not null default 'none'
    check (client_action_status in ('none','requested','responded')),

  -- Type-specific payload (varies by type):
  --   replace:         { campaign_title, creative_name, note }
  --   add:             { campaign_title, note }
  --   remove:          { campaign_title, creative_name }
  --   budget:          { campaign_title, current_spend, new_spend, reason }
  --   campaign-create: { offer, is_new_offer, new_offer_description,
  --                      monthly_spend, landing_page, note }
  fields jsonb not null default '{}'::jsonb,

  -- Uploaded files: array of { name, url, size, mime }
  files jsonb not null default '[]'::jsonb,

  -- Activity feed: array of
  --   { author_type: 'staff'|'client', author_id, author_name,
  --     body, is_action_request, created_at }
  messages jsonb not null default '[]'::jsonb,

  -- Staff assignment
  assigned_to uuid references public.staff(id) on delete set null,

  -- Timestamps
  submitted_at timestamptz default now(),
  updated_at   timestamptz default now(),
  resolved_at  timestamptz
);

-- Indexes for the common queries:
--   • staff queue filtered by status / content_check / client_action
--   • client portal filtered by client_id
create index marketing_tickets_client_idx        on public.marketing_tickets(client_id);
create index marketing_tickets_status_idx        on public.marketing_tickets(status);
create index marketing_tickets_content_check_idx on public.marketing_tickets(content_check_status) where status = 'in-progress';
create index marketing_tickets_client_action_idx on public.marketing_tickets(client_action_status) where status = 'in-progress';

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table public.marketing_tickets enable row level security;

-- Client: scoped to their own client row via clients.auth_user_id
create policy "Client read own marketing tickets"
  on public.marketing_tickets for select
  to authenticated
  using (client_id in (select id from public.clients where auth_user_id = auth.uid()));

create policy "Client insert own marketing tickets"
  on public.marketing_tickets for insert
  to authenticated
  with check (client_id in (select id from public.clients where auth_user_id = auth.uid()));

create policy "Client update own marketing tickets"
  on public.marketing_tickets for update
  to authenticated
  using (client_id in (select id from public.clients where auth_user_id = auth.uid()));

-- Staff: anyone in the `staff` table can read/write all rows
create policy "Staff read all marketing tickets"
  on public.marketing_tickets for select
  to authenticated
  using (exists (select 1 from public.staff where user_id = auth.uid()));

create policy "Staff insert marketing tickets"
  on public.marketing_tickets for insert
  to authenticated
  with check (exists (select 1 from public.staff where user_id = auth.uid()));

create policy "Staff update marketing tickets"
  on public.marketing_tickets for update
  to authenticated
  using (exists (select 1 from public.staff where user_id = auth.uid()));

-- Auto-update updated_at
create or replace function public.set_marketing_ticket_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger marketing_tickets_updated_at
  before update on public.marketing_tickets
  for each row execute function public.set_marketing_ticket_updated_at();;

-- ────────────────────────────────────────────────────────────
-- content_tickets: raw assets a client submits for the content
-- team to turn into a finished creative. When ready, the
-- content team uploads finals and clicks "Send to Marketing",
-- which spawns a downstream marketing_ticket.
-- ────────────────────────────────────────────────────────────
create table public.content_tickets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,

  -- Type: graphic vs video creative
  type text not null check (type in ('graphic', 'video')),

  -- Lifecycle
  --   active            : content team can pick this up
  --   client-dependent  : content team requested action from client; ball is in client's court
  --   completed         : finals shipped + sent to marketing (or ticket otherwise closed)
  --   cancelled
  status text not null default 'active'
    check (status in ('active', 'client-dependent', 'completed', 'cancelled')),

  client_action_status text not null default 'none'
    check (client_action_status in ('none', 'requested', 'responded')),

  -- Client-submitted payload
  notes text not null default '',
  raw_files jsonb not null default '[]'::jsonb,   -- array of { name, url, size, mime }

  -- Content-team output
  final_files jsonb not null default '[]'::jsonb, -- array of { name, url, size, mime }

  -- Optional campaign-level context (filled when this ticket came out of the
  -- new-campaign wizard — used to spawn the eventual marketing ticket).
  --   { offer, is_new_offer, new_offer_description, monthly_spend, landing_page,
  --     campaign_title, related_creative_name, source: 'change-campaign'|'new-campaign'|'add-creative' }
  context jsonb not null default '{}'::jsonb,

  -- When sent to marketing, link to the spawned marketing ticket
  marketing_ticket_id uuid references public.marketing_tickets(id) on delete set null,

  -- Activity feed (same shape as marketing_tickets.messages)
  messages jsonb not null default '[]'::jsonb,

  assigned_to uuid references public.staff(id) on delete set null,

  submitted_at timestamptz default now(),
  updated_at   timestamptz default now(),
  sent_to_marketing_at timestamptz,
  resolved_at  timestamptz
);

-- Indexes
create index content_tickets_client_idx        on public.content_tickets(client_id);
create index content_tickets_status_idx        on public.content_tickets(status);
create index content_tickets_client_action_idx on public.content_tickets(client_action_status) where status = 'active' or status = 'client-dependent';

-- Traceability column on marketing_tickets: link back to originating content ticket
alter table public.marketing_tickets
  add column if not exists originated_from_content_ticket_id uuid references public.content_tickets(id) on delete set null;

create index if not exists marketing_tickets_originated_from_idx
  on public.marketing_tickets(originated_from_content_ticket_id);

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table public.content_tickets enable row level security;

-- Client policies: scoped to their own client row
create policy "Client read own content tickets"
  on public.content_tickets for select
  to authenticated
  using (client_id in (select id from public.clients where auth_user_id = auth.uid()));

create policy "Client insert own content tickets"
  on public.content_tickets for insert
  to authenticated
  with check (client_id in (select id from public.clients where auth_user_id = auth.uid()));

create policy "Client update own content tickets"
  on public.content_tickets for update
  to authenticated
  using (client_id in (select id from public.clients where auth_user_id = auth.uid()));

-- Staff policies: anyone in the staff table can read/write all rows
create policy "Staff read all content tickets"
  on public.content_tickets for select
  to authenticated
  using (exists (select 1 from public.staff where user_id = auth.uid()));

create policy "Staff insert content tickets"
  on public.content_tickets for insert
  to authenticated
  with check (exists (select 1 from public.staff where user_id = auth.uid()));

create policy "Staff update content tickets"
  on public.content_tickets for update
  to authenticated
  using (exists (select 1 from public.staff where user_id = auth.uid()));

-- Auto-update updated_at
create or replace function public.set_content_ticket_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger content_tickets_updated_at
  before update on public.content_tickets
  for each row execute function public.set_content_ticket_updated_at();;

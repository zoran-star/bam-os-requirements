-- Creative Refresh Calendar (phase 1) - monthly client creative-update windows.
-- See memories/project_creative_refresh_calendar.md for the full scope.

alter table public.clients
  add column if not exists refresh_week int
  check (refresh_week between 1 and 4);

create table if not exists public.creative_refresh_windows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,
  window_start date not null,
  window_end date not null,
  status text not null default 'upcoming'
    check (status in ('upcoming','open','submitted','overdue','skipped')),
  nudges jsonb not null default '[]'::jsonb,
  submitted_ticket_id uuid,
  submitted_ticket_type text check (submitted_ticket_type in ('marketing','content','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists creative_refresh_windows_client_month
  on public.creative_refresh_windows (client_id, month);
create index if not exists creative_refresh_windows_month
  on public.creative_refresh_windows (month);

alter table public.creative_refresh_windows enable row level security;
drop policy if exists creative_refresh_windows_read on public.creative_refresh_windows;
create policy creative_refresh_windows_read on public.creative_refresh_windows
  for select using (is_staff() or client_id in (select my_client_ids()));
drop policy if exists creative_refresh_windows_write on public.creative_refresh_windows;
create policy creative_refresh_windows_write on public.creative_refresh_windows
  for all using (is_staff()) with check (is_staff());

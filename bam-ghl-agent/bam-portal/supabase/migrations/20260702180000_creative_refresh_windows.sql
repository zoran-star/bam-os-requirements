-- Creative Refresh Calendar (phase 1) - monthly client creative-update windows.
-- Each V1.5/V2 client gets a refresh_week anchor (1-4); a cron/on-demand generator
-- materializes one creative_refresh_windows row per client per month (Monday-Sunday
-- of their anchor week). Staff Marketing tab renders the week-lane calendar from
-- these rows; nudges (Slack + portal banner) and submission detection stamp them.
-- See memories/project_creative_refresh_calendar.md for the full scope.

-- Which week of the month (1-4) this client's creative refresh window anchors to.
-- NULL = not enrolled in the refresh calendar (default for all existing clients).
alter table public.clients
  add column if not exists refresh_week int
  check (refresh_week between 1 and 4);

create table if not exists public.creative_refresh_windows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,                       -- 'YYYY-MM' the window belongs to
  window_start date not null,               -- Monday of the client's anchor week
  window_end date not null,                 -- Sunday (inclusive)
  status text not null default 'upcoming'
    check (status in ('upcoming','open','submitted','overdue','skipped')),
  -- Nudge history: [{ at, by, kind }] - kind 'auto' (cron) | 'manual' (staff button).
  nudges jsonb not null default '[]'::jsonb,
  -- The ticket that satisfied this window (auto-detected or via "Mark received").
  submitted_ticket_id uuid,
  submitted_ticket_type text check (submitted_ticket_type in ('marketing','content','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One window per client per month; month index for the calendar query.
create unique index if not exists creative_refresh_windows_client_month
  on public.creative_refresh_windows (client_id, month);
create index if not exists creative_refresh_windows_month
  on public.creative_refresh_windows (month);

alter table public.creative_refresh_windows enable row level security;
-- Clients can read their own window (powers the phase-3 portal banner);
-- all writes go through the service-role API (staff-gated in code).
drop policy if exists creative_refresh_windows_read on public.creative_refresh_windows;
create policy creative_refresh_windows_read on public.creative_refresh_windows
  for select using (is_staff() or client_id in (select my_client_ids()));
drop policy if exists creative_refresh_windows_write on public.creative_refresh_windows;
create policy creative_refresh_windows_write on public.creative_refresh_windows
  for all using (is_staff()) with check (is_staff());

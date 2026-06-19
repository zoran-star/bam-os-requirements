-- V1.5 mass send: queued, throttled, DND-respecting bulk SMS/email to a
-- tag-filtered audience. A job + its per-recipient rows; a worker cron drains
-- pending recipients with rate-limit pacing.
create table if not exists public.mass_send_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null,                       -- 'SMS' | 'Email'
  tag text,
  subject text,
  body text,
  attachments jsonb not null default '[]',
  status text not null default 'queued',       -- queued | sending | done | canceled
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.mass_send_recipients (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.mass_send_jobs(id) on delete cascade,
  client_id uuid not null,
  contact_id text,
  name text,
  phone text,
  email text,
  status text not null default 'pending',      -- pending | sent | failed
  error text,
  sent_at timestamptz
);
create index if not exists mass_send_recipients_job_idx on public.mass_send_recipients(job_id);
create index if not exists mass_send_recipients_pending_idx on public.mass_send_recipients(job_id) where status = 'pending';
create index if not exists mass_send_jobs_client_idx on public.mass_send_jobs(client_id);

-- DND for the contact mirror — mass send must skip do-not-contact (GHL rule).
alter table public.ghl_contacts add column if not exists dnd boolean not null default false;

alter table public.mass_send_jobs enable row level security;
create policy msj_select on public.mass_send_jobs for select using (is_staff() or client_id in (select my_client_ids()));
create policy msj_write  on public.mass_send_jobs for all using (is_staff()) with check (is_staff());
alter table public.mass_send_recipients enable row level security;
create policy msr_select on public.mass_send_recipients for select using (is_staff() or client_id in (select my_client_ids()));
create policy msr_write  on public.mass_send_recipients for all using (is_staff()) with check (is_staff());;

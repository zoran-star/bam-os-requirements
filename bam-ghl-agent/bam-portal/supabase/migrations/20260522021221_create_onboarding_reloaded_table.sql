create table if not exists public.onboarding_reloaded (
  id              uuid primary key default gen_random_uuid(),
  submission_key  text unique not null,
  business_name   text,
  answers         jsonb not null default '{}'::jsonb,
  section_idx     int  not null default 0,
  status          text not null default 'in_progress',
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_onb_reloaded_key on public.onboarding_reloaded (submission_key);

alter table public.onboarding_reloaded enable row level security;

create policy "onb_reloaded insert" on public.onboarding_reloaded
  for insert to anon, authenticated with check (true);
create policy "onb_reloaded select" on public.onboarding_reloaded
  for select to anon, authenticated using (true);
create policy "onb_reloaded update" on public.onboarding_reloaded
  for update to anon, authenticated using (true);;

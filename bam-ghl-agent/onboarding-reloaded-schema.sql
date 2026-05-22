-- ════════════════════════════════════════════════════════════════
-- ONBOARDING RELOADED — Supabase table for the client onboarding flow
-- Project: jnojmfmpnsfmtqmwhopz  (BAM Business)
--
-- Run this whole file in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste → Run
-- It creates the single table that onboarding-reloaded.html syncs to.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.onboarding_reloaded (
  id              uuid primary key default gen_random_uuid(),
  submission_key  text unique not null,                  -- client-generated resume key (UUID)
  business_name   text,                                  -- pulled from answers, for staff identification
  answers         jsonb not null default '{}'::jsonb,    -- the full onboarding answer set
  section_idx     int  not null default 0,               -- which section they were last on
  status          text not null default 'in_progress',  -- in_progress | completed
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_onb_reloaded_key on public.onboarding_reloaded (submission_key);

-- ── RLS (prototype-grade) ───────────────────────────────────────
-- The flow is a standalone page with no login yet. Each submission is
-- gated by an unguessable submission_key (UUID). Anon may insert and
-- read/update. When this flow folds into the authed client portal,
-- replace these with client_id-scoped policies.
alter table public.onboarding_reloaded enable row level security;

create policy "onb_reloaded insert" on public.onboarding_reloaded
  for insert to anon, authenticated with check (true);
create policy "onb_reloaded select" on public.onboarding_reloaded
  for select to anon, authenticated using (true);
create policy "onb_reloaded update" on public.onboarding_reloaded
  for update to anon, authenticated using (true);

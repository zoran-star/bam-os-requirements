-- ─────────────────────────────────────────────────────────────────────────
-- Migration: device_tokens table for native push notifications
-- Date: 2026-05-20
-- Purpose: store APNs/FCM device tokens captured by the Capacitor wrapper
--          (bam-portal-app) so staff can later push notifications to clients.
-- Run: paste into the Supabase SQL editor (project jnojmfmpnsfmtqmwhopz) → Run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,                 -- APNs / FCM device token
  platform     text not null default 'unknown',      -- 'ios' | 'android' | 'web'
  auth_user_id uuid references auth.users(id)      on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists device_tokens_client_id_idx on public.device_tokens(client_id);
create index if not exists device_tokens_auth_user_idx on public.device_tokens(auth_user_id);

-- ── Row Level Security ───────────────────────────────────────────────────
-- A logged-in client can only see / manage their own device's token row.
-- The staff "send notification" backend (later) uses the service-role key,
-- which bypasses RLS — no extra staff policy needed.
alter table public.device_tokens enable row level security;

create policy "device_tokens_owner_select" on public.device_tokens
  for select using (auth_user_id = auth.uid());

create policy "device_tokens_owner_insert" on public.device_tokens
  for insert with check (auth_user_id = auth.uid());

create policy "device_tokens_owner_update" on public.device_tokens
  for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy "device_tokens_owner_delete" on public.device_tokens
  for delete using (auth_user_id = auth.uid());

-- ── Verification (run after the statements above) ────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'device_tokens' ORDER BY ordinal_position;
-- SELECT polname FROM pg_policies WHERE tablename = 'device_tokens';

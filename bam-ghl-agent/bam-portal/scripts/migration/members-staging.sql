-- ─────────────────────────────────────────────────────────────────────────
-- Migration: members_staging — THE PRICING SORTER import staging table
-- Date: 2026-06-08
-- Purpose: one shared, client-scoped staging table for CSV-imported members.
--          STEP 2 of the Pricing Sorter wizard bulk-inserts parsed rows here;
--          STEP 3 runs cleanup checks then PROMOTES eligible rows 1:1 into the
--          live public.members table. Columns deliberately mirror the live
--          `members` insert shape in api/onboarding/checkout.js so PROMOTE is a
--          straight column copy.
-- Scope: ONE shared table scoped by client_id (NOT one-table-per-client),
--        separate from the live `members` table.
-- RLS:   enabled, service-role only — all /api/sorter/* + /api/offers/* endpoints
--        read/write via the Supabase SERVICE key (sb()), like match-prices.js.
--        No client-side direct reads, so no per-row owner policy is needed.
-- Run:   Supabase MCP apply_migration, or paste into the SQL editor → Run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.members_staging (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  import_batch_id uuid not null,                 -- one upload = one batch (lets you re-run / discard)
  source_row      integer,                       -- original CSV row number for traceback
  -- mapped member fields (mirror the live `members` shape from checkout.js) --
  athlete_name    text,
  parent_name     text,
  parent_email    text,
  parent_phone    text,
  plan            text,                          -- raw plan label from their sheet
  offer_price_key text,                          -- resolved during cleanup (plan|term)
  status          text,                          -- raw status from sheet (active/cancelled/paused…)
  joined_date     date,
  stripe_customer_id     text,                   -- if present in sheet OR resolved by email in cleanup
  stripe_subscription_id text,
  stripe_price_id        text,                   -- resolved in cleanup from catalog by offer_price_key
  -- arbitrary leftover columns the owner did not map, kept for safety --
  raw             jsonb not null default '{}',
  -- cleanup bookkeeping --
  email_norm      text generated always as (lower(trim(parent_email))) stored,
  match_status    text not null default 'unreviewed', -- unreviewed|ok|needs_fix|duplicate|no_offer
  cleanup_notes   text,
  stripe_linked   boolean not null default false,
  is_duplicate    boolean not null default false,
  promoted        boolean not null default false,
  promoted_member_id uuid,                        -- the members.id created on promote
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists members_staging_client_idx       on public.members_staging(client_id);
create index if not exists members_staging_batch_idx        on public.members_staging(import_batch_id);
create index if not exists members_staging_client_email_idx on public.members_staging(client_id, email_norm);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Service-role only. The Sorter endpoints use the Supabase SERVICE key, which
-- bypasses RLS — enabling RLS with no policies blocks all anon/authenticated
-- direct reads while leaving the service-role backend fully functional.
alter table public.members_staging enable row level security;

-- ── Verification (run after the statements above) ────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'members_staging' ORDER BY ordinal_position;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'members_staging';

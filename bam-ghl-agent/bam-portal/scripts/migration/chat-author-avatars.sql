-- ─────────────────────────────────────────────────────────────────────────
-- Migration: avatar_url on staff + client_users (group-chat identities)
-- Date: 2026-06-05
-- Purpose: turn the support chat into a GROUP CHAT — each staff member and
--          each client teammate posts under their own name + avatar instead
--          of a single faceless "BAM team" identity. `members` already has
--          avatar_url; this adds it to the two author tables.
-- Run: paste into the Supabase SQL editor (project jnojmfmpnsfmtqmwhopz) → Run.
-- Safe: additive, nullable. Reuses the existing public `member-avatars` bucket
--       for the uploaded images (paths namespaced staff/… and user/…).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.staff        add column if not exists avatar_url text;
alter table public.client_users add column if not exists avatar_url text;

-- ── Verification ─────────────────────────────────────────────────────────
-- select table_name, column_name from information_schema.columns
--  where column_name = 'avatar_url' and table_name in ('staff','client_users','members');

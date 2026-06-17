-- add_ads_connected_at.sql
-- Applied to prod 2026-06-17 (migration: add_ads_connected_at_to_clients).
--
-- Signal column for the new 'connect_ads' onboarding action item — the client
-- connected their ad account via the Leadsie share link. Mirrors the other
-- *_at signal columns the onboarding steps reconcile against
-- (see api/action-items.js ONBOARDING_STEPS).
--
-- Part of the marketing-onboarding restructure that replaced the
-- "Book a call with Ximena (ads)" and "Submit your raw content" steps with:
--   • connect_ads   → Leadsie connection link
--   • add_campaign  → opens the new-campaign wizard (budget + asset filedrop)
-- (The old submit_content + book_call_ximena action_items rows were deleted.)

alter table public.clients add column if not exists ads_connected_at timestamptz;

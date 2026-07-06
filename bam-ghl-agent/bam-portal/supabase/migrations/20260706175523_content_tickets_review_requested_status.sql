-- BUG FIX: the content-approval-gate feature (2026-06-26, ads_content_approval)
-- introduced client_action_status='review-requested' in the send-for-review
-- action but never extended this CHECK constraint - so EVERY organic/gated-ads
-- "Send for client review" has failed with 23514 since then (hit by Eli
-- 2026-07-06). Same class of gotcha as staff_role_check: app-layer enum grew,
-- DB check did not.
-- Applied to prod 2026-07-06 via Supabase MCP as version 20260706175523.
alter table public.content_tickets
  drop constraint if exists content_tickets_client_action_status_check;
alter table public.content_tickets
  add constraint content_tickets_client_action_status_check
  check (client_action_status = any (array['none'::text, 'requested'::text, 'responded'::text, 'review-requested'::text]));

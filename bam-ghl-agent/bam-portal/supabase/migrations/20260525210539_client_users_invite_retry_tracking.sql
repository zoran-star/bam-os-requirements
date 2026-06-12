
-- Track auto-resend state per client_users row.
-- Cron checks: status='active' AND last_seen_at IS NULL (never logged in)
-- AND (last_invite_sent_at IS NULL OR last_invite_sent_at < now() - 20h)
-- AND invite_retry_count < 9 (caps at ~7 days of retries: 1 initial + 8 cron sends)
ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS last_invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_retry_count integer NOT NULL DEFAULT 0;

-- Initialize from created_at so candidates inserted before this migration
-- start the 20-hour clock from now (not the distant past — avoids a
-- thundering-herd on first cron run).
UPDATE public.client_users
   SET last_invite_sent_at = now()
 WHERE last_invite_sent_at IS NULL
   AND last_seen_at IS NULL;
;

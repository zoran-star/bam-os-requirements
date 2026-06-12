-- Tracks when the GHL→BAM contact polling cron last ran successfully
-- for this academy. Used by the cron itself (to skip recent runs if
-- a previous one is still in flight) and by future monitoring dashboards.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_contacts_last_synced_at timestamptz;;

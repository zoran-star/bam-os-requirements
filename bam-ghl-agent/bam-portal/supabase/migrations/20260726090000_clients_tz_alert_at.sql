-- Timezone-missing guardrail for the confirm agent's booking receipts.
-- When an academy has no usable clients.time_zone, the receipt still sends (in
-- America/Toronto) and the owner gets a one-line "set your timezone" SMS. This
-- column is the once-per-24h dedupe stamp for that SMS, written BEFORE the send
-- so two overlapping cron runs cannot double-notify. Mirrors the
-- ghl_token_error_at guardrail-column precedent. NULL means "never alerted".
alter table public.clients
  add column if not exists tz_alert_at timestamptz;

comment on column public.clients.tz_alert_at is
  'Last time the academy owner was texted that clients.time_zone is not set (confirm-agent booking receipts fall back to America/Toronto until they fix it). Dedupes that alert to once per 24h. NULL means never alerted.';

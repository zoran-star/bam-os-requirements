-- Per-academy owner/staff SMS notification recipients.
-- Shape: { "<event_key>": ["<client_users.id>", ...] } — which teammates get
-- texted (from the academy's own GHL number) for each event. Empty = nobody.
alter table clients add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

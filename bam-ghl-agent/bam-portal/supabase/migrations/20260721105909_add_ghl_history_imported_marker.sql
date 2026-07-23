-- Marker: when an academy's full GHL conversation history has been backfilled
-- into the own-store (sms_/email_ tables). NULL = not yet imported. Drives the
-- cron-import-history job so contacts + conversation history land together on
-- connect and every existing GHL academy backfills automatically.
alter table public.clients
  add column if not exists ghl_history_imported_at timestamptz;

comment on column public.clients.ghl_history_imported_at is
  'When full GHL conversation history was backfilled into sms_/email_ own-store (cron-import-history). NULL = pending.';

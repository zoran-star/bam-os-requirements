-- Surface "GHL reconnect needed" on a client without disturbing ghl_connect_status
-- (which has a CHECK constraint and drives existing "connected" UI logic).
alter table public.clients
  add column if not exists ghl_token_error text,
  add column if not exists ghl_token_error_at timestamptz;

comment on column public.clients.ghl_token_error is
  'Last GHL token mint/refresh failure for this academy. Non-null means the academy needs a GHL reconnect and its contact/pipeline sync is stopped. Cleared automatically on a successful mint.';
comment on column public.clients.ghl_token_error_at is
  'When ghl_token_error was last set.';

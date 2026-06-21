-- Short-lived cache of the assembled GHL inbox-list payload, per academy.
-- The inbox endpoint (api/ghl/inbox.js) builds this from several GHL calls
-- (conversations/search + a contacts/search per lead/client tag). Caching it for
-- ~25s means rapid reloads and the approval-count refresh cost ZERO GHL calls,
-- and when GHL rate-limits us (429) we serve the last good payload instead of
-- failing the whole inbox. Written by the service-role API only.

create table if not exists public.ghl_inbox_cache (
  client_id   uuid primary key references public.clients(id) on delete cascade,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.ghl_inbox_cache enable row level security;
-- No policies: only the service-role API (which bypasses RLS) touches this.

comment on table public.ghl_inbox_cache is
  'Per-academy cache of the inbox-list payload (~25s TTL). Lets api/ghl/inbox serve repeat loads without hitting GHL and serve stale data on a GHL 429.';

-- P1 "Spine": inbound-reply event log. GHL posts here whenever a parent replies
-- (via a workflow "Webhook" action on the "Customer replied" trigger). This is
-- the shared signal the later phases consume:
--   • Nudge engine  → cancel pending scheduled sends the instant a lead replies
--   • Sales agent    → wake up and own the thread on the first reply
-- Gated to V1.5/V2 academies in the webhook handler — V1 (GoHighLevel-native) is
-- never affected. (Apply via Supabase MCP, matching the other recent migrations.)
create table if not exists public.ghl_inbound_messages (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references public.clients(id) on delete cascade,
  ghl_location_id      text,
  ghl_contact_id       text,
  ghl_conversation_id  text,
  ghl_message_id       text,
  channel              text,                       -- 'sms' | 'email' | ...
  direction            text not null default 'inbound',
  body                 text,
  occurred_at          timestamptz,
  processed_at         timestamptz,                -- set by downstream consumers (nudge/agent)
  raw                  jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  -- Idempotency: GHL retries the webhook; ignore dupes on its message id.
  unique (client_id, ghl_message_id)
);

create index if not exists ghl_inbound_messages_client_idx
  on public.ghl_inbound_messages(client_id);
create index if not exists ghl_inbound_messages_contact_idx
  on public.ghl_inbound_messages(client_id, ghl_contact_id);
-- Fast scan for events not yet handled by a downstream consumer.
create index if not exists ghl_inbound_messages_unprocessed_idx
  on public.ghl_inbound_messages(client_id, occurred_at) where processed_at is null;

alter table public.ghl_inbound_messages enable row level security;
-- Staff see everything; an academy's own users see only their rows. Writes are
-- service-role only (the webhook), so no client/anon write policy.
create policy ghl_inbound_messages_select on public.ghl_inbound_messages
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy ghl_inbound_messages_write on public.ghl_inbound_messages
  for all using (is_staff()) with check (is_staff());

comment on table public.ghl_inbound_messages is
  'P1 Spine: log of inbound GHL replies (parent texts/emails) per academy. Populated by /api/ghl/inbound-webhook; consumed by the nudge engine + sales agent. V1.5/V2 only.';

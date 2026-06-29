-- Messaging provider spine: lets an academy send/receive SMS via its OWN Twilio
-- instead of GoHighLevel. DORMANT by default - every academy stays 'ghl' until its
-- messaging_provider is flipped to 'twilio' (the single toggle), and even then the
-- send path falls back to GHL unless client_twilio_config.status = 'active'.
--
-- Scope: SMS transport only. Contacts + pipeline + agents still live in GHL; the
-- sms_threads.ghl_contact_id mapping keeps the board/agents working after cutover.
-- See the messaging-spine plan; increments 2-5 (history import, sendText branch,
-- Twilio webhooks, inbox read-model) build on this. BAM GTA (V2) is the first flip.

-- 1. The toggle -------------------------------------------------------------
alter table public.clients
  add column if not exists messaging_provider text not null default 'ghl';
do $$ begin
  alter table public.clients
    add constraint clients_messaging_provider_chk
    check (messaging_provider in ('ghl','twilio'));
exception when duplicate_object then null; end $$;
comment on column public.clients.messaging_provider is
  'SMS transport for this academy: ''ghl'' (default, via GoHighLevel) or ''twilio'' (own Twilio). Flip to ''twilio'' AFTER the number transfer + client_twilio_config.status=''active''. Send path falls back to ghl if twilio config is not active.';

-- 2. Per-client Twilio credentials (secrets) --------------------------------
-- RLS enabled with NO policies => only the service role (portal API) can read/write.
-- The auth token / api secret are stored app-layer-encrypted (AES-256-GCM via the
-- MESSAGING_ENC_KEY env), so even a service-role leak does not expose raw creds.
create table if not exists public.client_twilio_config (
  client_id              uuid primary key references public.clients(id) on delete cascade,
  account_sid            text not null,
  auth_token_enc         text,           -- encrypted; OR use api key pair below
  api_key_sid            text,
  api_key_secret_enc     text,           -- encrypted
  from_number            text,           -- E.164; use this OR messaging_service_sid
  messaging_service_sid  text,
  status                 text not null default 'pending'
                           check (status in ('pending','active','disabled')),
  status_callback_verified boolean not null default false,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.client_twilio_config enable row level security;
comment on table public.client_twilio_config is
  'Per-academy Twilio credentials for direct-SMS mode. Secrets are app-layer encrypted (MESSAGING_ENC_KEY). RLS has no policies on purpose: service role only.';

-- 3. Provider-agnostic message store ----------------------------------------
-- One thread per (academy, contact phone). ghl_contact_id keeps the lead tied to
-- its GHL contact so the pipeline + agents keep working after the Twilio cutover.
create table if not exists public.sms_threads (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  contact_phone    text not null,        -- E.164 normalized
  ghl_contact_id   text,
  contact_name     text,
  last_message_at  timestamptz,
  last_preview     text,
  last_direction   text check (last_direction in ('inbound','outbound')),
  unread           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, contact_phone)
);
create index if not exists sms_threads_client_idx
  on public.sms_threads(client_id, last_message_at desc nulls last);
create index if not exists sms_threads_ghl_contact_idx
  on public.sms_threads(client_id, ghl_contact_id);

create table if not exists public.sms_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references public.sms_threads(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete cascade,
  provider            text not null check (provider in ('ghl','twilio')),
  direction           text not null check (direction in ('inbound','outbound')),
  channel             text not null default 'sms',
  body                text,
  status              text,              -- queued|sent|delivered|failed|received|undelivered
  error               text,
  twilio_sid          text,              -- Twilio MessageSid
  ghl_message_id      text,              -- present for imported/mirrored GHL messages
  ghl_conversation_id text,
  sent_by             text,              -- staff email / agent key for outbound
  occurred_at         timestamptz not null,
  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
-- idempotency so re-running the GHL import or a Twilio retry never duplicates
create unique index if not exists sms_messages_twilio_sid_uq
  on public.sms_messages(twilio_sid) where twilio_sid is not null;
create unique index if not exists sms_messages_ghl_msg_uq
  on public.sms_messages(client_id, ghl_message_id) where ghl_message_id is not null;
create index if not exists sms_messages_thread_idx
  on public.sms_messages(thread_id, occurred_at);
create index if not exists sms_messages_client_idx
  on public.sms_messages(client_id, occurred_at desc);

alter table public.sms_threads enable row level security;
alter table public.sms_messages enable row level security;
-- Same pattern as ghl_inbound_messages: staff see all, client_users see their own,
-- writes are service-role / staff only.
do $$ begin
  create policy sms_threads_select on public.sms_threads
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sms_threads_write on public.sms_threads
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sms_messages_select on public.sms_messages
    for select using (is_staff() or client_id in (select my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sms_messages_write on public.sms_messages
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

comment on table public.sms_threads is
  'Provider-agnostic SMS conversation per (academy, contact phone). The own-store that replaces GHL conversations for academies on messaging_provider=''twilio''. ghl_contact_id maps back to GHL so pipeline+agents keep working.';
comment on table public.sms_messages is
  'Provider-agnostic SMS message log (inbound+outbound). Populated by the GHL history import (provider=ghl), the Twilio inbound webhook (provider=twilio,direction=inbound), and the sendText() outbound path. Idempotent on twilio_sid and (client_id,ghl_message_id).';

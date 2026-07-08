-- Meta DM spine (1/4): direct Instagram + FB Messenger DMs, off GoHighLevel.
-- The social sibling of the Twilio SMS spine (20260629150000) and the Resend
-- email spine (20260702190000). DORMANT by default - nothing changes for any
-- academy until a client_meta_messaging_config row exists with status='active'.
-- Until then the inbox serves social via the GHL passthrough (api/ghl/inbox.js
-- listGhlSocialThreads).
--
-- Scope: message transport + store only. Increments: (2) inbound webhook
-- api/meta/inbound-webhook.js, (3) inbox read + Graph API send, (4) contact
-- mint + pipeline/agent side-effects. BAM GTA is the first flip.

-- 1. Per-client Meta messaging config ---------------------------------------
-- RLS enabled with NO policies => service role (portal API) only. The page
-- access token is app-layer encrypted (AES-256-GCM via MESSAGING_ENC_KEY),
-- same as client_twilio_config secrets.
create table if not exists public.client_meta_messaging_config (
  client_id        uuid primary key references public.clients(id) on delete cascade,
  page_id          text not null,        -- Facebook Page id (Messenger events key on this)
  ig_user_id       text,                 -- Instagram professional account id (IG events key on this)
  page_token_enc   text,                 -- encrypted Page access token (used for sends + profile lookups)
  status           text not null default 'pending'
                     check (status in ('pending','active','disabled')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.client_meta_messaging_config enable row level security;
create index if not exists client_meta_msg_cfg_page_idx
  on public.client_meta_messaging_config(page_id);
create index if not exists client_meta_msg_cfg_ig_idx
  on public.client_meta_messaging_config(ig_user_id);
comment on table public.client_meta_messaging_config is
  'Per-academy Meta (Instagram + FB Messenger) DM config. page_token_enc is app-layer encrypted (MESSAGING_ENC_KEY). RLS has no policies on purpose: service role only. status=active turns the direct Meta DM spine on for the academy.';

-- 2. Provider-agnostic DM store ---------------------------------------------
-- One thread per (academy, channel, platform-scoped user id). psid is Meta's
-- page-scoped id: IGSID for Instagram, PSID for Messenger - it is the stable
-- per-page key Meta gives us for a person (no phone/email on this channel).
-- ghl_contact_id ties the thread to the portal contacts store / pipeline once
-- increment 4 mints or matches a contact (nullable until then).
create table if not exists public.dm_threads (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  channel          text not null check (channel in ('instagram','facebook')),
  psid             text not null,
  ghl_contact_id   text,
  contact_name     text,
  ig_username      text,
  last_message_at  timestamptz,
  last_preview     text,
  last_direction   text check (last_direction in ('inbound','outbound')),
  unread           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, channel, psid)
);
create index if not exists dm_threads_client_idx
  on public.dm_threads(client_id, last_message_at desc nulls last);
create index if not exists dm_threads_ghl_contact_idx
  on public.dm_threads(client_id, ghl_contact_id);

create table if not exists public.dm_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.dm_threads(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  provider         text not null default 'meta' check (provider in ('meta','ghl')),
  direction        text not null check (direction in ('inbound','outbound')),
  channel          text not null check (channel in ('instagram','facebook')),
  body             text,
  attachments      jsonb not null default '[]'::jsonb,
  status           text,                 -- received|sent|delivered|failed
  error            text,
  meta_message_id  text,                 -- Meta message mid (webhook + send responses)
  ghl_message_id   text,                 -- present for imported/mirrored GHL messages
  sent_by          text,                 -- staff email / agent key / 'meta-native' for echoes
  occurred_at      timestamptz not null,
  raw              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
-- idempotency: Meta retries webhook deliveries; a re-run must never duplicate
create unique index if not exists dm_messages_meta_mid_uq
  on public.dm_messages(client_id, meta_message_id) where meta_message_id is not null;
create unique index if not exists dm_messages_ghl_msg_uq
  on public.dm_messages(client_id, ghl_message_id) where ghl_message_id is not null;
create index if not exists dm_messages_thread_idx
  on public.dm_messages(thread_id, occurred_at);
alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;
comment on table public.dm_threads is
  'Instagram/FB Messenger DM threads (own-store, off GHL). psid = Meta page-scoped user id (IGSID/PSID). Service role only (no RLS policies).';
comment on table public.dm_messages is
  'Messages for dm_threads. meta_message_id (mid) is the idempotency key for webhook retries. Service role only (no RLS policies).';

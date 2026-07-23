-- Email spine (5/n): 2-way MAILBOX sync foundation. Adds the connected-mailbox
-- store so an academy's OWN inbox (Gmail / Outlook / IMAP) mirrors the portal for
-- HUMAN 1-to-1 email, while Resend keeps handling automated/bulk (email_provider).
-- DORMANT: adds the table + columns; nothing reads/writes them until the connect
-- flow + inbound sync + send routing land and an academy connects a mailbox.
-- Mirrors client_twilio_config (encrypted creds) + the Resend email spine.

-- One connected mailbox per academy (shared inbox model, e.g. info@domain).
create table if not exists public.client_mailboxes (
  client_id          uuid primary key references public.clients(id) on delete cascade,
  provider           text not null check (provider in ('gmail','outlook','imap')),
  email              text not null,               -- the connected address (from OAuth, not typed)
  -- OAuth providers (gmail/outlook): encrypted refresh token, app-layer AES-256-GCM
  -- via env MESSAGING_ENC_KEY (same _crypto.js as Twilio). NULL for imap.
  refresh_token_enc  text,
  -- IMAP/SMTP fallback creds (encrypted password). NULL for gmail/outlook.
  imap_host          text,
  imap_port          integer,
  imap_username      text,
  imap_password_enc  text,
  smtp_host          text,
  smtp_port          integer,
  -- Sync cursors: gmail history_id (incremental sync) + watch expiry (renew cron).
  history_id         text,
  watch_expiry       timestamptz,
  status             text not null default 'active' check (status in ('active','needs_reconnect','error')),
  last_error         text,
  last_synced_at     timestamptz,
  connected_by       text,                        -- user id/email that authorized it
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists client_mailboxes_status_idx on public.client_mailboxes(status);

-- Extend the email_messages provider enum to cover the mailbox providers.
alter table public.email_messages drop constraint if exists email_messages_provider_check;
alter table public.email_messages
  add constraint email_messages_provider_check
  check (provider in ('ghl','resend','gmail','outlook','imap'));

-- Threading + idempotency for mailbox-sourced messages (Gmail/IMAP give us stable
-- ids + RFC Message-ID headers we thread on; resend_id/ghl_message_id stay as-is).
alter table public.email_messages add column if not exists mailbox_message_id text; -- provider msg id
alter table public.email_messages add column if not exists mailbox_thread_id  text; -- provider thread id
alter table public.email_messages add column if not exists message_id_header  text; -- RFC5322 Message-ID
alter table public.email_messages add column if not exists in_reply_to        text; -- parent Message-ID
create unique index if not exists email_messages_mailbox_uidx
  on public.email_messages(client_id, mailbox_message_id) where mailbox_message_id is not null;

-- RLS: staff or my_client_ids can read; writes are service-role only (the connect
-- flow + sync webhooks use the service role, which bypasses RLS). Mirrors the
-- email_threads / email_messages / contacts policies.
alter table public.client_mailboxes enable row level security;
do $$ begin
  create policy client_mailboxes_sel on public.client_mailboxes for select
    using (public.is_staff() or client_id in (select public.my_client_ids()));
exception when duplicate_object then null; end $$;

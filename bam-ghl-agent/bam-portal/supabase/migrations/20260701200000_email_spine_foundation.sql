-- Email spine (1/n): off-GHL email via Resend, mirroring the Twilio SMS spine.
-- DORMANT: adds the toggle + own-store; nothing reads/writes them until the
-- inbound webhook + inbox read branch land and an academy is flipped. Applied to
-- prod via MCP (like the sibling foundations); this file is the record.

-- Per-academy toggle. 'resend' only takes effect once the inbound webhook is
-- wired and the academy's receiving domain is set; else falls back to 'ghl'.
alter table public.clients add column if not exists email_provider text not null default 'ghl';
do $$ begin
  alter table public.clients add constraint clients_email_provider_chk check (email_provider in ('ghl','resend'));
exception when duplicate_object then null; end $$;
-- Receiving domain for inbound routing (e.g. 'byanymeanstoronto.ca'); the inbound
-- webhook matches an incoming message's To-domain to the owning academy.
alter table public.clients add column if not exists email_domain text;

-- One thread per (academy, external email). Mirrors sms_threads.
create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_email text not null,
  ghl_contact_id text,
  contact_name text,
  last_message_at timestamptz,
  last_preview text,
  last_subject text,
  last_direction text check (last_direction in ('inbound','outbound')),
  unread boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, contact_email)
);
create index if not exists email_threads_client_idx on public.email_threads(client_id, last_message_at desc);
create index if not exists email_threads_ghl_idx on public.email_threads(client_id, ghl_contact_id);

-- One row per email in/out. Mirrors sms_messages (idempotent on provider ids).
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text check (provider in ('ghl','resend')),
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null default 'email',
  subject text,
  body text,
  status text,
  resend_id text,
  ghl_message_id text,
  ghl_conversation_id text,
  sent_by text,
  occurred_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists email_messages_resend_uidx on public.email_messages(resend_id) where resend_id is not null;
create unique index if not exists email_messages_ghlmsg_uidx on public.email_messages(client_id, ghl_message_id) where ghl_message_id is not null;
create index if not exists email_messages_thread_idx on public.email_messages(thread_id, occurred_at);

-- RLS: staff or my_client_ids can read; writes are service-role only (mirrors the
-- contacts store). Service role bypasses RLS, so the webhooks/inbox API are fine.
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
do $$ begin
  create policy email_threads_sel on public.email_threads for select
    using (public.is_staff() or client_id in (select public.my_client_ids()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy email_messages_sel on public.email_messages for select
    using (public.is_staff() or client_id in (select public.my_client_ids()));
exception when duplicate_object then null; end $$;

-- Resend email foundation (P3): the audit trail + suppression list backing
-- api/_email.js (the shared sender) and api/resend/webhook.js (the event sink).
--
--   email_events       - every send + every Resend delivery/bounce/complaint event.
--   email_suppressions - addresses we must never email again (hard bounce / complaint
--                        / unsubscribe). sendEmail() checks this before every send.
-- Service-role API writes bypass RLS; staff get read-only via the policies below.

create table if not exists public.email_events (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references public.clients(id) on delete set null,
  provider_message_id  text,                       -- Resend email id
  email                text,                       -- recipient (lowercased)
  type                 text,                       -- 'sent' | 'email.delivered' | 'email.bounced' | ...
  payload              jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists email_events_email_idx   on public.email_events (email);
create index if not exists email_events_type_idx    on public.email_events (type);
create index if not exists email_events_created_idx on public.email_events (created_at);

create table if not exists public.email_suppressions (
  email       text primary key,                    -- store LOWERCASED
  reason      text,                                -- 'bounced' | 'complained' | 'unsubscribed' | ...
  client_id   uuid references public.clients(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.email_events       enable row level security;
alter table public.email_suppressions enable row level security;

-- Staff-only read (mirrors the agent_closing_replies pattern). All writes go through
-- the service-role API (api/_email.js, api/resend/webhook.js), which bypasses RLS.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='email_events' and policyname='email_events_select') then
    create policy email_events_select on public.email_events for select using (is_staff());
  end if;
  if not exists (select 1 from pg_policies where tablename='email_suppressions' and policyname='email_suppressions_select') then
    create policy email_suppressions_select on public.email_suppressions for select using (is_staff());
  end if;
end $$;

comment on table public.email_events is
  'Email send + Resend delivery-event audit log (api/_email.js sends, api/resend/webhook.js events).';
comment on table public.email_suppressions is
  'Do-not-email list (hard bounce / complaint / unsubscribe). Checked by api/_email.js before every send.';

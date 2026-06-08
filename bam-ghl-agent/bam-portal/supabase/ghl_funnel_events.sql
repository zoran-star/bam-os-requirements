-- Funnel event log — the source for the GHL/Stripe KPIs.
--
-- One row per real event, captured live:
--   lead       — a tracked GHL form was submitted (free-trial / contact)
--   response   — the lead sent an inbound message (or booked)
--   booking    — the lead booked a trial on the GHL calendar
--   conversion — the lead went live on Stripe (active subscription)
--
-- KPIs COUNT these in a date range (not pipeline-stage snapshots):
--   leads, response rate, booking rate, conversion rate, and CAC (vs Meta spend).
-- Forward-only — it fills as events arrive from the GHL + Stripe webhooks.
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz) — or use
-- the /apply-sql skill.

create table if not exists public.ghl_funnel_events (
  id            bigint generated always as identity primary key,
  client_id     uuid,                 -- portal clients.id (null if unmatched)
  ghl_location  text,                 -- GHL location id/name from the webhook
  event_type    text not null,        -- 'lead' | 'response' | 'booking' | 'conversion'
  contact_id    text,                 -- GHL contact id
  contact_email text,
  contact_phone text,
  ref           text,                 -- submission/message/appointment/subscription id
  value         numeric,              -- e.g. subscription amount for conversions
  occurred_at   timestamptz not null default now(),
  raw           jsonb,
  created_at    timestamptz not null default now()
);

-- Idempotency: the same event (same type + source id) only counts once on retry.
-- Must be NON-partial: PostgREST's on_conflict=event_type,ref can only use a plain
-- unique index as the conflict arbiter (a partial index needs its WHERE predicate,
-- which PostgREST doesn't send → inserts error out). All pulled events set `ref`,
-- and unique treats NULLs as distinct, so a plain unique is safe.
drop index if exists uq_ghl_event_type_ref;
create unique index if not exists uq_ghl_event_type_ref
  on public.ghl_funnel_events (event_type, ref);

create index if not exists idx_ghl_events_client_time
  on public.ghl_funnel_events (client_id, occurred_at);
create index if not exists idx_ghl_events_client_type_time
  on public.ghl_funnel_events (client_id, event_type, occurred_at);

-- Service-role (API) only.
alter table public.ghl_funnel_events enable row level security;

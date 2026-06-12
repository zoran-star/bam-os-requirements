create table if not exists public.members_staging (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  import_batch_id uuid not null,
  source_row      integer,
  athlete_name    text,
  parent_name     text,
  parent_email    text,
  parent_phone    text,
  plan            text,
  offer_price_key text,
  status          text,
  joined_date     date,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  raw             jsonb not null default '{}',
  email_norm      text generated always as (lower(trim(parent_email))) stored,
  match_status    text not null default 'unreviewed',
  cleanup_notes   text,
  stripe_linked   boolean not null default false,
  is_duplicate    boolean not null default false,
  promoted        boolean not null default false,
  promoted_member_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists members_staging_client_idx       on public.members_staging(client_id);
create index if not exists members_staging_batch_idx        on public.members_staging(import_batch_id);
create index if not exists members_staging_client_email_idx on public.members_staging(client_id, email_norm);

alter table public.members_staging enable row level security;;

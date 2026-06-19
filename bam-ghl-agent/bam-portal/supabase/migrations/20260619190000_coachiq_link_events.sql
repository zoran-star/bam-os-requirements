-- CoachIQ bulk-link "listening session": records each tag-added webhook hit/miss so the
-- import UI can live-check-off linked members and flag webhooks whose email isn't matched.
create table if not exists coachiq_link_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  email text,
  coachiq_user_id text,
  matched boolean not null default false,
  target text,
  staging_id uuid,
  member_id uuid,
  tag text,
  created_at timestamptz not null default now()
);
create index if not exists coachiq_link_events_client_created on coachiq_link_events (client_id, created_at desc);

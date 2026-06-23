-- Staff-triggered, blocking onboarding feedback form (client portal).
-- Staff request it from the client Overview tab; the client portal hard-blocks
-- until the client submits. Responses land in onboarding_feedback.
alter table clients add column if not exists onboarding_feedback_requested_at timestamptz;
alter table clients add column if not exists onboarding_feedback_submitted_at timestamptz;

create table if not exists onboarding_feedback (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  submitted_by uuid,
  full_name text,
  rating_clarity int,
  rating_comfort int,
  rating_strategy int,
  rating_communication int,
  rating_confidence int,
  most_helpful text,
  confusing text,
  excited_about text,
  improve text,
  main_focus text,
  additional_guidance text,
  testimonial text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists onboarding_feedback_client_idx on onboarding_feedback(client_id);
-- Service-role only (the portal API reads/writes with the service key); no client-direct access.
alter table onboarding_feedback enable row level security;

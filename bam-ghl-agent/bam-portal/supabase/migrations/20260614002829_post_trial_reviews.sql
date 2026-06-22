-- Post-trial review captured when a coach submits the post-trial form.
-- good_fit=true → opportunity moves to Done Trial, trainer is assigned, and a
-- signup-link text is QUEUED (not sent until the comms tab exists).
create table if not exists public.post_trial_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  opportunity_id text not null,
  ghl_contact_id text,
  good_fit boolean,
  trainer text,
  notes text,
  -- queued | sent | skipped — gated until the comms tab can actually send
  signup_text_status text not null default 'queued',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, opportunity_id)
);
alter table public.post_trial_reviews enable row level security; -- service-key only;

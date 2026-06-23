-- Dedup store for post-trial escalation texts (so each overdue trial only pings once).
create table if not exists post_trial_escalations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  appointment_id text not null,
  ghl_contact_id text,
  created_at timestamptz not null default now(),
  unique (client_id, appointment_id)
);
alter table post_trial_escalations enable row level security;

create table if not exists pipeline_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  pipeline_id text not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (client_id, pipeline_id)
);;

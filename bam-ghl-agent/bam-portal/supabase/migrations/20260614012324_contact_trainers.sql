-- Per-contact trainer assignment (the coach leading the sale). Written by the
-- post-trial form and editable inline from the Communications tab. Drives the
-- per-trainer tabs.
create table if not exists public.contact_trainers (
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_contact_id text not null,
  trainer text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, ghl_contact_id)
);
alter table public.contact_trainers enable row level security; -- service-key only;

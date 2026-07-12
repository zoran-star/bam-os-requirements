-- Per-athlete custom-field answers.
--
-- custom_field_values live on the CONTACT (the parent), which is correct for
-- parent-level info but WRONG for athlete-specific answers (First/Last name,
-- Age, "close to Oakville?") when siblings share one parent/Stripe customer -
-- the second athlete would overwrite the first. This table stores those answers
-- against the MEMBER (athlete) instead, so each kid keeps their own values.
--
-- Read model (api/custom-fields.js ?action=values): member-level value OVERLAYS
-- the contact-level one when a member_id is supplied; otherwise the contact
-- value shows (unchanged for single-athlete / lead contacts).

create table if not exists public.member_field_values (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  field_id   uuid not null references public.custom_field_defs(id) on delete cascade,
  value      jsonb,                          -- typed by the def, same shape as contact_field_values
  updated_at timestamptz not null default now(),
  unique (member_id, field_id)
);
create index if not exists member_field_values_member_idx on public.member_field_values(member_id);
create index if not exists member_field_values_field_idx  on public.member_field_values(field_id);

alter table public.member_field_values enable row level security;

-- Visibility follows the member's academy (join to members). Writes = staff /
-- service role (the API writes with the service key; owners/staff read).
do $$ begin
  create policy member_field_values_select on public.member_field_values
    for select using (exists (
      select 1 from public.members m
      where m.id = member_field_values.member_id
        and (is_staff() or m.client_id in (select my_client_ids()))));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy member_field_values_write on public.member_field_values
    for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

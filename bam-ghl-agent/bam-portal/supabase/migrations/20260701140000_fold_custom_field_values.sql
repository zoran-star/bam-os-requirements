-- Fold GHL blob values into typed contact_field_values (Custom Fields, P4b).
-- Once fields are imported (custom_field_defs.ghl_field_id set), this maps every
-- contact's opaque contacts.custom_fields blob (keyed by GHL field id) onto the
-- matching def and writes a typed contact_field_values row. Idempotent; called
-- by the import action after adopting GHL fields, and re-runnable any time.
--
-- Value is stored as jsonb verbatim from the blob (keeps arrays for multiselect).
-- Skips missing / null / empty-string values. Returns rows upserted.

create or replace function public.fold_custom_field_values(p_client_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with upserted as (
    insert into public.contact_field_values (contact_id, field_id, value, updated_at)
    select c.id, d.id, c.custom_fields -> d.ghl_field_id, now()
    from public.contacts c
    join public.custom_field_defs d
      on d.client_id = c.client_id
     and d.ghl_field_id is not null
    where c.client_id = p_client_id
      and c.custom_fields ? d.ghl_field_id
      and c.custom_fields -> d.ghl_field_id is not null
      and c.custom_fields -> d.ghl_field_id <> '""'::jsonb
      and c.custom_fields -> d.ghl_field_id <> 'null'::jsonb
      and c.custom_fields -> d.ghl_field_id <> '[]'::jsonb
    on conflict (contact_id, field_id) do update
      set value = excluded.value, updated_at = now()
    returning 1
  )
  select coalesce(count(*), 0)::int from upserted;
$$;

comment on function public.fold_custom_field_values(uuid) is
  'Maps a client''s contacts.custom_fields GHL blob onto imported custom_field_defs (by ghl_field_id) into typed contact_field_values. Idempotent; run after importing GHL fields.';

grant execute on function public.fold_custom_field_values(uuid) to service_role, authenticated;

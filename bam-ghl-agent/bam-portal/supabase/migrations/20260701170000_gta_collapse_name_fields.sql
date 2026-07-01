-- Collapse GTA's 4 athlete-name fields into First + Last, and retire the fields
-- that aren't owner custom questions (Custom Fields, P4b). Applied to prod via
-- MCP; this file is the record + local-replay parity. Guarded (skips if the GTA
-- client is absent) and idempotent (name backfill uses on-conflict-do-nothing,
-- archive is a flag flip). Key-based lookups so it survives fresh-replay uuids.
--
-- Model: First Name + Last Name are the two canonical name fields; full name is
-- derived (First + Last). Automations address casually via {{athlete_first_name}}
-- and formally via {{athletes_full_name}}. Dropped as custom fields (archived,
-- reversible): the two full-name copies, Free Trial Date (booking data), the
-- post-trial form fields (showed-up, lead sales person), and Inquiry (freeform).

do $$
declare
  gta uuid := '39875f07-0a4b-4429-a201-2249bc1f24df';
  f_full uuid; f_player uuid; f_first uuid; f_last uuid;
begin
  if not exists (select 1 from public.clients where id = gta) then
    raise notice 'BAM GTA client absent - skipping name-collapse (local replay).';
    return;
  end if;

  select id into f_full   from public.custom_field_defs where client_id=gta and key='athlete_full_name';
  select id into f_player from public.custom_field_defs where client_id=gta and key='player_full_name';
  select id into f_first  from public.custom_field_defs where client_id=gta and key='athlete_first_name';
  select id into f_last   from public.custom_field_defs where client_id=gta and key='athlete_last_name';

  if f_first is not null and (f_full is not null or f_player is not null) then
    -- Resolve each contact's full name (prefer Athlete's Full Name, else Player).
    with src as (
      select c.id as contact_id,
        coalesce(nullif(fnv.value #>> '{}',''), nullif(pnv.value #>> '{}','')) as nm
      from public.contacts c
      left join public.contact_field_values fnv on fnv.contact_id=c.id and fnv.field_id=f_full
      left join public.contact_field_values pnv on pnv.contact_id=c.id and pnv.field_id=f_player
      where c.client_id = gta
    ),
    resolved as (
      select contact_id,
        split_part(trim(nm),' ',1) as first_nm,
        nullif(trim(substring(trim(nm) from '\s+(.*)$')),'') as last_nm
      from src where nm is not null and trim(nm) <> ''
    )
    insert into public.contact_field_values (contact_id, field_id, value, updated_at)
    select contact_id, f_first, to_jsonb(first_nm), now()
    from resolved where first_nm is not null and first_nm <> ''
    on conflict (contact_id, field_id) do nothing;

    with src as (
      select c.id as contact_id,
        coalesce(nullif(fnv.value #>> '{}',''), nullif(pnv.value #>> '{}','')) as nm
      from public.contacts c
      left join public.contact_field_values fnv on fnv.contact_id=c.id and fnv.field_id=f_full
      left join public.contact_field_values pnv on pnv.contact_id=c.id and pnv.field_id=f_player
      where c.client_id = gta
    ),
    resolved as (
      select contact_id, nullif(trim(substring(trim(nm) from '\s+(.*)$')),'') as last_nm
      from src where nm is not null and trim(nm) <> ''
    )
    insert into public.contact_field_values (contact_id, field_id, value, updated_at)
    select contact_id, f_last, to_jsonb(last_nm), now()
    from resolved where last_nm is not null
    on conflict (contact_id, field_id) do nothing;
  end if;

  -- Retire fields that aren't owner custom questions (reversible flag).
  update public.custom_field_defs set archived=true, updated_at=now()
  where client_id=gta
    and key in ('athlete_full_name','player_full_name','free_trial_date','did_athlete_show_up','lead_sales_person','inquiry');

  -- Order the 5 keepers.
  update public.custom_field_defs set position = case key
      when 'athlete_first_name'  then 0
      when 'athlete_last_name'   then 1
      when 'athlete_age'         then 2
      when 'close_to_oakville'   then 3
      when 'start_training_when' then 4 end
  where client_id=gta
    and key in ('athlete_first_name','athlete_last_name','athlete_age','close_to_oakville','start_training_when');
end $$;

-- Attach GTA's EXTRA custom questions to its published Training offer so they
-- render in the offer wizard's Sales step (Custom Fields, P4b). Applied to prod
-- via MCP; file is the record + local-replay parity. Guarded + idempotent +
-- key-based (survives fresh-replay uuids).
--
-- Model that emerged: academy-level defs (offer_id null) = CORE data collected on
-- every offer (athlete first/last/age); offer-scoped defs (offer_id + section) =
-- EXTRA per-offer questions authored in the wizard. These two - Close-to-Oakville
-- and start-timing - are GTA's lead-form extras, so they belong on the offer's
-- Sales section. Their contact_field_values (160 / 344) are keyed by field id and
-- carry over untouched.

do $$
declare
  gta uuid := '39875f07-0a4b-4429-a201-2249bc1f24df';
  training_offer uuid;
begin
  if not exists (select 1 from public.clients where id = gta) then
    raise notice 'BAM GTA client absent - skipping offer attach (local replay).';
    return;
  end if;

  select id into training_offer
  from public.offers
  where client_id = gta and type = 'training' and status = 'published'
  order by created_at
  limit 1;

  if training_offer is null then
    raise notice 'No published GTA training offer - skipping offer attach.';
    return;
  end if;

  update public.custom_field_defs
  set offer_id = training_offer, section = 'sales', updated_at = now()
  where client_id = gta
    and archived = false
    and key in ('close_to_oakville', 'start_training_when');
end $$;

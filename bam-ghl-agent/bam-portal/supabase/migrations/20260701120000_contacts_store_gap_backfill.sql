-- Own-contacts store (Contacts effort, PR 3a - data). Closes the mirror gap.
-- P2 revealed that ghl_contacts is an INCOMPLETE mirror: some website_leads and
-- opportunities reference GHL contact ids that were never synced into
-- ghl_contacts, so they had no contact row to link to. Here we materialize a
-- contact row from the lead/opp's own captured fields so every row with a GHL
-- contact id links to a portal contact. Idempotent (unique client_id+ghl id).
-- Still dormant: nothing reads public.contacts yet.

-- 1. Create missing contacts from website_leads (has name/email/phone) --------
insert into public.contacts (client_id, ghl_contact_id, name, email, phone, source)
select distinct on (w.client_id, w.ghl_contact_id)
  w.client_id, w.ghl_contact_id, w.name, w.email, w.phone, 'lead-backfill'
from public.website_leads w
where w.ghl_contact_id is not null and w.contact_id is null
order by w.client_id, w.ghl_contact_id, w.created_at desc nulls last
on conflict (client_id, ghl_contact_id) do nothing;

-- 2. Create missing contacts from opportunities (name/phone/athlete, no email) -
insert into public.contacts (client_id, ghl_contact_id, name, phone, athlete_name, source)
select distinct on (o.client_id, o.ghl_contact_id)
  o.client_id, o.ghl_contact_id, o.contact_name, o.contact_phone, o.athlete_name, 'opp-backfill'
from public.opportunities o
where o.ghl_contact_id is not null and o.contact_id is null
order by o.client_id, o.ghl_contact_id
on conflict (client_id, ghl_contact_id) do nothing;

-- 3. Re-link now that the contacts exist -------------------------------------
update public.website_leads w set contact_id = c.id
  from public.contacts c
 where c.client_id = w.client_id and c.ghl_contact_id = w.ghl_contact_id
   and w.ghl_contact_id is not null and w.contact_id is null;
update public.opportunities o set contact_id = c.id
  from public.contacts c
 where c.client_id = o.client_id and c.ghl_contact_id = o.ghl_contact_id
   and o.ghl_contact_id is not null and o.contact_id is null;

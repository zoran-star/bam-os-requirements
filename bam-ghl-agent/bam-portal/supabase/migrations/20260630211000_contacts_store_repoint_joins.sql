-- Own-contacts store (Contacts effort, PR 2). PURELY ADDITIVE, DORMANT.
-- Adds the portal contact_id foreign key to every table that currently joins
-- people by ghl_contact_id, and backfills it from public.contacts by matching
-- (client_id, ghl_contact_id). This makes the portal-native join key available
-- everywhere so a later PR can dual-read (prefer contact_id, fall back to
-- ghl_contact_id) and eventually drop the GHL id.
--
-- Nothing reads contact_id yet - the code still joins on ghl_contact_id, so
-- behavior is byte-identical. Rows with no matching contact (e.g. a member whose
-- GHL contact was never mirrored) keep contact_id null; the dual-read fallback
-- handles those. on delete set null keeps a contact delete from cascading.

-- 1. members ------------------------------------------------------------------
alter table public.members
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists members_contact_id_idx on public.members(contact_id);
update public.members m
   set contact_id = c.id
  from public.contacts c
 where c.client_id = m.client_id
   and c.ghl_contact_id = m.ghl_contact_id
   and m.ghl_contact_id is not null
   and m.contact_id is null;

-- 2. website_leads ------------------------------------------------------------
alter table public.website_leads
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists website_leads_contact_id_idx on public.website_leads(contact_id);
update public.website_leads w
   set contact_id = c.id
  from public.contacts c
 where c.client_id = w.client_id
   and c.ghl_contact_id = w.ghl_contact_id
   and w.ghl_contact_id is not null
   and w.contact_id is null;

-- 3. opportunities ------------------------------------------------------------
alter table public.opportunities
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists opportunities_contact_id_idx on public.opportunities(contact_id);
update public.opportunities o
   set contact_id = c.id
  from public.contacts c
 where c.client_id = o.client_id
   and c.ghl_contact_id = o.ghl_contact_id
   and o.ghl_contact_id is not null
   and o.contact_id is null;

comment on column public.members.contact_id is
  'Portal-native contact FK (public.contacts). Dormant until dual-read lands; code still joins on ghl_contact_id. Backfilled by matching (client_id, ghl_contact_id).';
comment on column public.website_leads.contact_id is
  'Portal-native contact FK (public.contacts). Dormant until dual-read lands; code still joins on ghl_contact_id.';
comment on column public.opportunities.contact_id is
  'Portal-native contact FK (public.contacts). Dormant until dual-read lands; code still joins on ghl_contact_id.';

-- contacts.phone10 - the last 10 digits of the phone, kept in sync by Postgres.
--
-- Why: contacts.phone is stored in whatever shape its source used. Today 22,228
-- rows are E.164 ("+16044424595"), 71 are bare 10-digit ("6044424595") and one is
-- human-formatted ("(604) 442-4595"). Every dedup lookup used `phone=eq.<raw>`,
-- an EXACT string compare, so a website enroll for someone already synced from
-- GHL never matched and minted a SECOND contact for the same person. That is how
-- the Gbolonyo family ended up on two contacts (2026-07-24) and, because every
-- signed-up-lead guard keys on ghl_contact_id, kept a Hawkeye closing card after
-- they had already paid.
--
-- A generated column (rather than normalizing contacts.phone in place) keeps the
-- original string exactly as its source gave it - dialing, display and any GHL
-- round-trip are untouched - while giving PostgREST a plain equality column to
-- filter and index on. Short/junk numbers still produce a short value here; the
-- callers only ever query with a full 10 digits, so those can never be hit.
alter table public.contacts
  add column if not exists phone10 text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;

create index if not exists contacts_client_phone10_idx
  on public.contacts (client_id, phone10)
  where phone10 <> '';

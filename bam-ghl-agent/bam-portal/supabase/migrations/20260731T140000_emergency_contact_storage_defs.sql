-- Emergency contact: give the answer somewhere to land, for every academy.
--
-- THE BUG. The membership enroll form asks every parent for an emergency contact
-- name and phone, and REQUIRES both (REQUIRED_INTAKE_LABELS in
-- api/website/offer.js; owner ruling, required for every academy on the shared
-- preset). The answer was then dropped on the floor. Not by an error - by a gap:
-- those two questions are a CODE BLOCK in buildFields rather than
-- custom_field_defs rows, and api/_contacts.js writePortalFieldValues resolves a
-- submitted answer to a def BY KEY. No academy had the key, so nothing matched
-- and nothing was written.
--
--   select count(*) from custom_field_defs
--    where key ilike '%emergency%' or label ilike '%emergency%';
--   -- 0, across all 3 academies, 2026-07-31
--
-- The answers survive only inside member_audit_log.args.intake: 18 enrollments,
-- 13 distinct members, 2026-06-16 to 2026-07-25. That is an audit trail, not a
-- field a coach can read off a member's record when they actually need it.
--
-- WHAT THIS MIGRATION DOES. Adds the two academy-level defs to the academies
-- ALREADY USING PORTAL CUSTOM FIELDS, so the field exists on their contact
-- records from the moment this runs. It writes definitions only. It does NOT
-- backfill a single value - see below.
--
-- WHY NOT `FROM clients` FLAT. The first cut of this file did exactly that, and
-- EXPLAIN said what it would really do: 47 academies x 2 rows = 94 inserts. The
-- clients table is every academy BAM has, and the overwhelming majority are V1 -
-- no portal offer, no enroll form, no chance of an emergency contact answer. They
-- would each have picked up two permanent empty fields in their contact drawer
-- for a form they do not have, which is a change to academies this build has no
-- business touching. The predicate below is the honest scope: an academy that
-- already has at least one custom_field_defs row is one that uses this machinery.
-- Today that is 3 academies (6 rows), against 47 clients and 16 with any offer.
--
-- A PORTAL-NATIVE ACADEMY WITH NO DEFS YET IS NOT MISSED. It is simply not
-- covered HERE - ensureStorageOnlyDefs() mints both rows on its first enrollment,
-- which is the guarantee that actually matters and the one that does not depend
-- on anybody running SQL. This migration is the convenience half: it makes the
-- field visible on existing records now rather than on next enrollment.
--
-- WHY offer_id IS NULL. Academy-level, so api/custom-fields.js returns it for
-- every contact regardless of which offer they bought, and the Members drawer
-- renders it for all of them. An emergency contact belongs to the person, not to
-- the purchase. section is NULL for the same reason: a section would scope it to
-- the lead or member drawer, and it is wanted on both.
--
-- WHY required IS FALSE ON THE ROW. The enroll form's requirement is enforced in
-- CODE (REQUIRED_INTAKE_LABELS), where it has always been, and these rows are
-- never rendered as form fields at all - api/website/offer.js skips them at its
-- def-rendering choke point, or the enroll form would ask the same question
-- twice and the lead form would start asking a stranger for their emergency
-- contact. Setting required=true here would change nothing about the form and
-- would make a manually-blank value look like a validation failure in the
-- drawer. The row's job is storage; the form's job is asking.
--
-- ON CONFLICT DO NOTHING IS LOAD-BEARING, NOT HABIT. The same rows are minted at
-- runtime by ensureStorageOnlyDefs() on the enrollment path, so a new academy
-- gets them without waiting for anyone to run SQL, and an academy that enrolled
-- somebody between this file being written and being applied already has them.
-- Whichever runs second must be a no-op. It also protects an academy that
-- ARCHIVED its emergency field or relabelled it: the conflict target is
-- (client_id, key), so its own row wins and this migration leaves it alone.
-- Archiving is a deliberate act by an owner and nothing here overrides it.
--
-- NO VALUE BACKFILL, ON PURPOSE. The 18 historical answers are recoverable from
-- member_audit_log, and recovering them is a HUMAN DECISION rather than a side
-- effect of a schema migration: it writes personal data onto contact records
-- from a source that was never meant to be authoritative, and one of those
-- contacts may since have been merged, renamed or split across households.
-- scripts/recover-emergency-contacts.mjs REPORTS what is recoverable and writes
-- nothing without an explicit flag. Run it, read it, then decide.

INSERT INTO public.custom_field_defs
  (client_id, key, label, type, options, position, required, archived, offer_id, section)
SELECT c.id, d.key, d.label, d.type, '[]'::jsonb, d.position, false, false, NULL, NULL
FROM public.clients c
CROSS JOIN (VALUES
  ('emergency_contact_name',  'Emergency contact name',  'text',  100),
  ('emergency_contact_phone', 'Emergency contact phone', 'phone', 101)
) AS d(key, label, type, position)
WHERE EXISTS (SELECT 1 FROM public.custom_field_defs x WHERE x.client_id = c.id)
ON CONFLICT (client_id, key) DO NOTHING;

COMMENT ON TABLE public.custom_field_defs IS
  'Per-academy contact/member field definitions. Most are rendered as form questions by api/website/offer.js buildFields. A few are STORAGE-ONLY (emergency_contact_name, emergency_contact_phone): the enroll form renders those questions from code, so the def exists purely to give the answer a row, and buildFields skips those keys - see STORAGE_ONLY_DEF_KEYS in api/_contacts.js. ghl_field_id reconciles to GHL while still dual-writing; null once GHL is off.';

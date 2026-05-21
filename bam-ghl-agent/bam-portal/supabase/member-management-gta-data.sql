-- ============================================================
-- Member Management — BAM GTA roster migration (Phase 1b)
--
-- Moves BAM GTA's live athlete roster from the GTA Supabase project
-- (oatwstyzxreujgsbmaxr) into the portal Supabase (jnojmfmpnsfmtqmwhopz),
-- scoped under BAM GTA's `clients` row.
--
-- Run AFTER member-management-schema.sql. No MCP needed — this is a
-- two-project copy you drive by hand:
--   SECTION A → PORTAL Supabase — ensure the BAM GTA clients row exists
--   SECTION B → GTA Supabase    — generator: prints a ready-to-run INSERT
--   SECTION C → PORTAL Supabase — paste + run SECTION B's output
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- SECTION A — run in the PORTAL Supabase (jnojmfmpnsfmtqmwhopz)
--
-- 1. Find BAM GTA's clients row:
--      SELECT id, business_name FROM clients
--      WHERE business_name ILIKE '%gta%' OR business_name ILIKE '%any means%';
--
-- 2a. If a BAM GTA row EXISTS but is NOT named exactly 'BAM GTA' —
--     change the 'BAM GTA' literal in SECTION B to match its business_name.
-- 2b. If NO row exists — create one (uncomment + run):
--
-- INSERT INTO clients (business_name, status) VALUES ('BAM GTA', 'active');
-- ─────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────
-- SECTION B — run in the GTA Supabase (oatwstyzxreujgsbmaxr)
--
-- GENERATOR. Reads GTA's live `members` table and prints ONE ready-to-run
-- INSERT statement for the portal. Run it, then click the result cell and
-- copy the entire text. format(%L) handles all quoting/escaping + NULLs.
-- ─────────────────────────────────────────────────────────
SELECT
  E'INSERT INTO members\n'
  || E'  (client_id, athlete_name, archetype, trainer, group_num, plan, status,\n'
  || E'   engagement, skill_notes, parent_name, parent_archetype, parent_email,\n'
  || E'   parent_phone, stripe_customer_id, stripe_subscription_id, ghl_contact_id,\n'
  || E'   coachiq_member_id, joined_date)\nVALUES\n'
  || string_agg(
       format(
         '  ((SELECT id FROM clients WHERE business_name = %L), %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
         'BAM GTA',
         athlete_name, archetype, trainer, group_num, plan, status,
         engagement, skill_notes, parent_name, parent_archetype, parent_email,
         parent_phone, stripe_customer_id, stripe_subscription_id, ghl_contact_id,
         coachiq_member_id, joined_date
       ),
       E',\n' ORDER BY athlete_name
     )
  || E';'
  AS portal_members_insert
FROM members;


-- ─────────────────────────────────────────────────────────
-- SECTION C — run in the PORTAL Supabase (jnojmfmpnsfmtqmwhopz)
--
-- Paste the text SECTION B produced below this line, and run it. It inserts
-- every GTA athlete into the portal `members` table, scoped to BAM GTA's
-- client_id (resolved by the embedded business_name subquery).
--
-- Verify afterwards:
--   SELECT count(*) FROM members
--   WHERE client_id = (SELECT id FROM clients WHERE business_name = 'BAM GTA');
--
-- Re-running? Clear GTA's rows first to avoid duplicates:
--   DELETE FROM members
--   WHERE client_id = (SELECT id FROM clients WHERE business_name = 'BAM GTA');
-- ─────────────────────────────────────────────────────────
-- <paste SECTION B output here>

-- ⚠️ DATA MIGRATION - THIS IS THE ONE THAT TURNS RECEIPTS ON.
--
-- 20260731T190000_member_receipts.sql builds the whole system and turns on NOTHING
-- (receipt_mode is NULL for every academy after it runs, and NULL is OFF). This
-- file is the switch, and it is a separate file on purpose: applying the schema
-- must not commit anybody to sending parent-facing mail, and deciding WHO sends it
-- should be a one-line diff somebody can read, not a side effect buried in a table
-- definition.
--
-- APPLY THE SCHEMA FIRST. This file will error usefully if receipt_mode does not
-- exist yet, which is the right failure.
--
-- WHO, AND WHY THESE TWO. BAM GTA and BAM San Jose are the two academies running on
-- the V2 billing spine with real Stripe subscriptions today. Both go to 'recurring'
-- (a receipt for every payment) per the owner's ruling, 30 Jul 2026.
--
-- THIS IS NOT AN ACADEMY BRANCH. Nothing in the application asks which academy it is
-- serving; receipt_mode is a value on a row, and this file sets two of them the way
-- an owner would from the portal. A third academy joins by getting its own row set,
-- with no code change anywhere.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ MATCHED BY NAME, AND THE COUNT IS ENFORCED, NOT NARRATED.
--
-- The session that wrote this cannot see production, so the WHERE below matches on
-- business_name rather than on ids it would have to guess. That means the match can
-- be wrong in two directions, and both are bad: too few and the academies the owner
-- asked for stay silent, too many and an academy nobody decided about starts emailing
-- real parents.
--
-- So the count is a HARD ASSERTION inside the transaction. Anything other than
-- exactly 2 raises, the whole DO block rolls back, and NOTHING is turned on. An
-- earlier draft of this file printed a NOTICE saying "EXPECT 2" and committed
-- whatever it did - which is the failure shape this repo keeps hitting: a check whose
-- output nobody reads, sitting where a guard should be. A migration that narrates a
-- wrong outcome has still applied it.
--
-- If it raises: find the real business_name, fix the WHERE, re-run. Do NOT widen the
-- match to make the number come out right.
--
-- THE NAMES ARE NOT GUESSES. Both come from the repo's own production snapshots -
-- scripts/snapshots/bam-gta.json ("BAM GTA") and scripts/snapshots/bam-san-jose.json
-- ("BAM San Jose"), the same fixtures the GTA byte-for-byte email locks render from.
-- api/_member-receipts.test.mjs reads those two files and fails if this WHERE stops
-- matching what they say, so the pair cannot drift apart silently.
--
-- The `= 'BAM GTA'`-style exact match is deliberate over ILIKE '...%': a prefix match
-- is what would silently pick up a second row named "BAM GTA West" the day one is
-- created, and the assertion below would then fire on a file that had been correct
-- for months. Exact names fail closed at the point of ambiguity instead.
--
-- The v2_access guard is belt and braces (the code checks it too), and it means a
-- name collision with a V1 academy cannot switch that academy on.

DO $$
DECLARE
  touched integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'receipt_mode'
  ) THEN
    RAISE EXCEPTION 'clients.receipt_mode does not exist - apply 20260731T190000_member_receipts.sql first';
  END IF;

  UPDATE public.clients
     SET receipt_mode = 'recurring'
   WHERE v2_access IS TRUE
     AND business_name IN ('BAM GTA', 'BAM San Jose');

  GET DIAGNOSTICS touched = ROW_COUNT;

  IF touched <> 2 THEN
    RAISE EXCEPTION
      'receipt_mode seed matched % V2 academy row(s), expected exactly 2 (BAM GTA, BAM San Jose). Nothing has been turned on - this block has rolled back. Find the real business_name values and fix the WHERE; do not widen the match.', touched;
  END IF;

  RAISE NOTICE 'receipt_mode = recurring set on 2 academy rows (BAM GTA, BAM San Jose).';
END $$;

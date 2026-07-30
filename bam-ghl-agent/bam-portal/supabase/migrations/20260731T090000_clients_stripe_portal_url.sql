-- clients.stripe_portal_url - the academy's own Stripe billing portal, for MEMBERS.
--
-- ⚠️ SCOPE, AND THE REASON THIS FILE IS SO SMALL.
--
-- The `receipts` build owns the wider receipt-system work, and the column below is part
-- of that system's surface. THIS MIGRATION IS ONLY THE COLUMN, and only because one
-- thing outside that build is blocked on it: the member welcome email's
-- manage-membership link (Zoran, 31 Jul 2026). It adds nothing else - no receipt
-- tables, no backfill, no constraint, no comment on anything the receipts build might
-- want to word differently later. It is deliberately the smallest thing that unblocks
-- the link, so the two builds cannot collide over the shape of the wider system.
--
-- `IF NOT EXISTS` is load-bearing rather than habit: the receipts build's own migration
-- will declare this column too, and it must REPLAY AS A NO-OP whichever of the two runs
-- first. Neither build has to know about the other's ordering, and neither has to be
-- rewritten if the order changes.
--
-- WHY IT SHIPS AS A MIGRATION RATHER THAN A PENDING COLUMN. The first cut of the
-- welcome-email build read this column through CLIENT_COLS_PENDING - the 42703-tolerant
-- retry that lets a read ship ahead of its migration. That mechanism is correct and it
-- stays in the code, but it costs one wasted 400 plus a retry on EVERY uncached clients
-- read, and it logs a warning on every single send while it does so. Orchestrator
-- ruling, 31 Jul 2026: not acceptable indefinitely, because a warning that fires
-- correctly and forever is a warning people learn to scroll past. So the column ships
-- first and the code reads it from the MAIN select lists, with the pending lists back
-- to empty. This SQL is applied BEFORE the code merges, for the same reason
-- 20260729T210000 and 20260730T160000 were: an additive column is inert until something
-- reads it, so migration-first closes the window at no cost, while merge-first would
-- leave every academy's email select 400ing on a column that is not there.
--
-- EMPTY IS A REAL STATE, and today it is the state of EVERY academy. Nullable on
-- purpose, no default, no backfill. NULL means "this academy has not set up a billing
-- portal", and the welcome email then renders no manage-membership sentence at all -
-- not a dead link, not an orphan lead-in. That is the shipped behaviour the day this
-- runs, and it stays the behaviour until an owner enters a URL. There is deliberately
-- NO fallback anywhere in the code: an academy sending its parents to another academy's
-- billing portal, where they would see subscriptions that are not theirs, is far worse
-- than an academy sending no link.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS stripe_portal_url text;

COMMENT ON COLUMN public.clients.stripe_portal_url IS
  'The academy''s own Stripe customer billing portal URL, shown to MEMBERS (the welcome email''s manage-membership link). NULL means the academy has not set one up, and no link is sent - never another academy''s.';

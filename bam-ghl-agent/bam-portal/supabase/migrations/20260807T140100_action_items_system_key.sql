-- OFF-STRIPE PAYMENTS, step 2: a typed key for system-created action items.
--
-- Design: docs/plans/off-stripe-payments-design.md section 3, build fact 2.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM THIS REPLACES. action_items has exactly one typed key today,
-- onboarding_key, and it is reserved for the fixed onboarding steps. Everything
-- else a system creates is found again by MATCHING ITS TITLE TEXT:
--
--   action_items?...&title=ilike.*Cancel%20old%20Stripe%20sub*     (api/members.js:711)
--
-- That is a banner count driven by prose. Rewording the title - which is a copy
-- edit, the safest kind of change there is - silently zeroes the count, and the
-- owner walks away with foreign Stripe subs still billing. It also cannot be
-- idempotent: two runs of the same generator produce two identical items,
-- because there is nothing for a unique index to be unique ON.
--
-- system_key is that thing. It is the machine's name for WHY an item exists,
-- independent of what it says.
--
-- Shape convention (the API is the enforcer, not this file - a CHECK would make
-- adding a caller a migration):
--   stop-billing:<member_id>          the double-billing guard
--   collect:<collection_id>           one off-card collection reminder
--
-- The old title-matching read at api/members.js:711 is deliberately LEFT ALONE
-- in this pass. Ripping it out is a separate change with its own blast radius;
-- what this migration guarantees is that nothing NEW has to be written that way.
ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS system_key text;

-- One row per (client, system_key). NULLs are DISTINCT in Postgres, so every
-- hand-written item (system_key NULL) is unaffected and there can be as many as
-- anyone likes - the same property that lets action_items_client_onboarding_key_uk
-- coexist with ad-hoc items.
--
-- This index IS the idempotency of the generate-and-notify cron. The cron does
-- not ask "did I already make this one?"; it inserts, and Postgres rejects the
-- second one with 23505. No read-then-write window, so two overlapping cron runs
-- cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS action_items_client_system_key_uk
  ON public.action_items (client_id, system_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- created_by_role: 'system' is admitted.
--
-- The existing constraint is CHECK (created_by_role IN ('client','staff')) and
-- created_by is a bare uuid meaning an auth.users id. A cron has neither: no
-- JWT, no user, no name. The column is nullable, so a system row COULD simply
-- leave the role NULL and satisfy the old constraint - and that is exactly why
-- this widening is deliberate rather than incidental.
--
-- NULL role would mean "nobody recorded who made this", which is already true of
-- older rows and is unfalsifiable. 'system' means "no human made this, a cron
-- did", which is a fact, and it makes the machine-created items queryable as a
-- set: an owner asking "what did the portal decide on its own?" gets an answer.
-- The item is still attributable through system_key, which names the reason.
--
-- Widened, not dropped. A typo in a role still fails.
ALTER TABLE public.action_items
  DROP CONSTRAINT IF EXISTS action_items_created_by_role_check;
ALTER TABLE public.action_items
  ADD CONSTRAINT action_items_created_by_role_check
  CHECK (created_by_role IS NULL OR created_by_role IN ('client','staff','system'));

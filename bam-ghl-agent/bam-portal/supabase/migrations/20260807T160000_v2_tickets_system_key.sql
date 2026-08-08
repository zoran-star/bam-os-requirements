-- MEMBER APPLY, deferred-mint queue: a typed key for system-created v2_tickets.
--
-- Design: docs/plans/member-apply-engine-plan.md decision E (the archived-price
-- mint for an uncovered member is a live Stripe write, so it does NOT auto-happen
-- at apply - it goes through the BAM review queue), and docs/plans/
-- v2-action-item-map.md item P1 (one v2_tickets row per apply carrying the mint
-- targets in intake).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A KEY. The member apply engine (api/workbook.js) queues ONE ticket per
-- (client, offer, family, amount) for each uncovered member's archived-price
-- mint. Apply is rerunnable - approve, apply, approve again, apply again - and an
-- uncovered member stays uncovered until the price side's live mint populates the
-- catalog, so the SAME apply produces the SAME mint request on every run. Without
-- a key, each rerun inserts another identical ticket, exactly the drift the
-- action_items title-string precedent already suffered (api/members.js:711).
--
-- system_key is the machine's name for WHY the ticket exists, independent of its
-- title copy. It mirrors action_items.system_key (20260807T140100), so the two
-- system-created queues share one idempotency shape.
--
-- Shape convention (the API is the enforcer, not this file - a CHECK would make
-- adding a caller a migration):
--   archived-price-mint:<offer_id | family-slug>:<amount_cents | noamt>
ALTER TABLE public.v2_tickets
  ADD COLUMN IF NOT EXISTS system_key text;

-- One row per (client, system_key). NULLs are DISTINCT in Postgres, so every
-- human/client-created ticket (system_key NULL) is unaffected and there can be as
-- many as anyone likes - the same property that lets action_items' key indexes
-- coexist with ad-hoc rows.
--
-- This index IS the idempotency of the deferred-mint queue. The apply does not
-- ask "did I already queue this?"; it inserts, and Postgres rejects the second
-- with 23505, which createSystemTicket() reads as { created:false } and returns
-- the existing ticket. No read-then-write window, so two overlapping applies
-- cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS v2_tickets_client_system_key_uk
  ON public.v2_tickets (client_id, system_key);

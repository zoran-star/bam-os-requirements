-- Two additive columns found while building the workbook page and API. Both are
-- separated from the answers table on purpose: neither is a decision the owner
-- makes, and anything that is not a decision must not be able to serialize as one.

-- ── workbook_answers.current_value ──────────────────────────────────────────
-- THREE values matter, not two, and conflating any pair loses the case this
-- schema was written for:
--   current_value : what the portal stores TODAY   ("2 Trainings/Week")
--   proposed      : what we SHOWED the owner        ("Academy 2x/week")
--   answered      : what the owner SENT BACK
--
-- Staff review compares current_value against answered. Without this column the
-- only available comparison is proposed against answered, so a card the owner
-- merely CONFIRMED WITHOUT EDITING would read as "no change" while silently
-- rewriting the stored plan title. That is not hypothetical: for San Jose the
-- workbook prefills Lij's own Stripe names and three of four differ from what
-- the portal holds.
ALTER TABLE public.workbook_answers
  ADD COLUMN IF NOT EXISTS current_value jsonb;

-- ── workbook_cards.meta ─────────────────────────────────────────────────────
-- Presentation facts that are NOT answers: "9 members pay on this plan today",
-- the Live-in-Stripe pill, the family colour stripe, per-rung counts.
--
-- These live on the CARD because that is the unit the owner reads, and they are
-- deliberately NOT in workbook_answers: a fact we computed must never be able to
-- appear as something the owner confirmed. Nothing in here is ever applied to
-- configuration.
--
-- The API tolerates this column being absent (it catches PostgREST 42703 and
-- omits meta entirely), so an environment that has not run this migration
-- degrades to a page without the context strip rather than an error.
ALTER TABLE public.workbook_cards
  ADD COLUMN IF NOT EXISTS meta jsonb;

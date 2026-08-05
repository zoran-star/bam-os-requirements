-- Owner-facing WORKBOOKS: the surface an academy owner uses to confirm facts we
-- inferred about their business, before any of it becomes live configuration.
--
-- Two kinds share these tables on purpose (Zoran, 2026-08-04): the PRICE
-- workbook (what the academy sells) and the MEMBER workbook (who is enrolled and
-- on what). One product family to the owner, one schema for staff review, and
-- skills 1 and 2 both read this rather than each inventing a convention.
--
-- WHY THREE TABLES AND NOT ONE JSON BLOB
-- The requirement is STRUCTURED DECISIONS, never a free-text payload, because a
-- consuming agent must read a DECISION and not a value. The load-bearing rule,
-- in Zoran's framing: "confirmed" is a DELIBERATE ACT distinct from "untouched",
-- and AN UNREAD CARD MUST NOT SERIALIZE IDENTICALLY TO AN APPROVED ONE. If that
-- distinction lives only in the page it does not exist, because the page is gone
-- by the time staff review the answers.
--
-- INERT WHEN APPLIED: zero rows until a workbook is created, and no shipped code
-- path reads these tables until the workbook build merges.

-- ── the send ────────────────────────────────────────────────────────────────
-- One row per workbook handed to one owner. The token IS the credential: the
-- link carries it and there is no login (Zoran: "fine for now, we will change it
-- in teh future" - an ACCEPTED RISK WITH A DATE, not a permanent design).
CREATE TABLE IF NOT EXISTS public.workbooks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('price','member')),
  -- crypto-random, carried in the link as /workbook/<token>. Unguessable and
  -- revocable by flipping status to 'void' - which is the whole mitigation for
  -- the no-login decision, so it must stay unique and never be derived from
  -- client_id or anything else an outsider could construct.
  token          text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','submitted','reviewed','applied','void')),
  -- NULLABLE AND UNENFORCED TODAY, on purpose. The no-login link was accepted
  -- WITH A DATE, so the column exists now to make expiry a config change rather
  -- than a migration. No shipped code reads it yet; do not claim the link
  -- expires until something does.
  expires_at     timestamptz,
  sent_at        timestamptz,
  submitted_at   timestamptz,   -- the owner pressed Send. Nothing is applied yet.
  reviewed_at    timestamptz,   -- staff looked at the answers
  reviewed_by    uuid,
  applied_at     timestamptz,   -- the answers became live configuration
  applied_by     uuid,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The owner-facing lookup is BY TOKEN on every page load, so it is indexed as
-- the hot path rather than client_id.
CREATE INDEX IF NOT EXISTS workbooks_client_kind_idx ON public.workbooks (client_id, kind);

-- ── the unit of confirmation ────────────────────────────────────────────────
-- A CARD, not a row. Zoran ruled confirmation is CARD-level: a commitment rung
-- is part of one plan's answer, not a separate decision. So state lives here and
-- nowhere else - denormalizing it onto answers would let the two disagree, and
-- the whole point of this table is that "confirmed" cannot be faked.
--
-- NO PARTIAL SUBMIT (Zoran, program-wide, binds BOTH workbooks): a workbook may
-- only move to 'submitted' when EVERY card is confirmed or changed. That is
-- enforced in the submit route, not by a constraint, because a half-filled
-- workbook must still be SAVEABLE - the owner comes back to it.
CREATE TABLE IF NOT EXISTS public.workbook_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id  uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  -- stable slug, e.g. 'tax', 'plan:<offer_price_id>', 'codes', 'notes'. NEVER a
  -- display name: plan titles are labels and this one is an identifier.
  card_key     text NOT NULL,
  title        text,          -- display only
  sort_order   integer NOT NULL DEFAULT 0,
  state        text NOT NULL DEFAULT 'untouched'
                 CHECK (state IN ('untouched','confirmed','changed')),
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workbook_cards_key_idx
  ON public.workbook_cards (workbook_id, card_key);

-- ── the decisions ───────────────────────────────────────────────────────────
-- One row per fact the owner can change. `proposed` is what WE showed them,
-- `answered` is what came back. Keeping both is what makes staff review possible
-- at all, and it is why a card the owner merely confirmed without editing still
-- records a real change when our prefill differed from what is stored.
--
-- That is not hypothetical for San Jose: the workbook prefills Lij's own Stripe
-- plan names ("Academy 2x/week") while the portal stores "2 Trainings/Week", so
-- three of four plans differ. Confirming an untouched card RENAMES the plan.
-- It must serialize as a was/now change, never as an unchanged row.
CREATE TABLE IF NOT EXISTS public.workbook_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id  uuid NOT NULL REFERENCES public.workbooks(id) ON DELETE CASCADE,
  card_id      uuid NOT NULL REFERENCES public.workbook_cards(id) ON DELETE CASCADE,
  -- Tenant scope is carried here as well as on the workbook. Denormalized on
  -- purpose: every academy-scoped row must be filterable by tenant without a
  -- join, and a staff review query that forgets the join is a cross-academy leak.
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- THE ENVELOPE. target_kind is its own field rather than being inferred from
  -- target_table because BLAST RADIUS DIFFERS BY AN ORDER OF MAGNITUDE: a wrong
  -- price row costs one plan, a wrong tax rate re-prices every athlete in the
  -- academy. Staff review MUST be able to sort on it and surface academy_setting
  -- FIRST, visually separated, never buried in a long list of price rows where a
  -- tax change reads like a typo fix.
  target_kind  text NOT NULL CHECK (target_kind IN ('academy_setting','price_row','member_row')),
  -- Provider-neutral: the table and row we would write, never a Stripe id. The
  -- referenced row carries its own provider ids (offer_prices.stripe_price_id
  -- and so on), so they are resolved at apply time rather than copied and
  -- allowed to drift.
  target_table text NOT NULL,          -- 'clients' | 'offer_prices' | 'members' | ...
  target_id    uuid,                   -- the concrete row; for academy_setting this is the client
  target_field text,                   -- 'tax_config', 'price', 'title', ...

  proposed     jsonb,                  -- what we showed  (the "was")
  answered     jsonb,                  -- what came back  (the "now")

  -- Apply is per answer so a single bad row can be held back without discarding
  -- the owner's whole workbook. Once applied_at is set the row is history: the
  -- was/now pair IS the audit record for a pricing change, so nothing may
  -- rewrite it afterwards.
  applied_at   timestamptz,
  apply_error  text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workbook_answers_card_idx ON public.workbook_answers (card_id);
CREATE INDEX IF NOT EXISTS workbook_answers_review_idx
  ON public.workbook_answers (workbook_id, target_kind);
CREATE INDEX IF NOT EXISTS workbook_answers_client_idx ON public.workbook_answers (client_id);

-- ── access ──────────────────────────────────────────────────────────────────
-- Service-role only: RLS enabled with NO policies, matching client_stripe_direct.
-- The owner's browser NEVER talks to Supabase for this - it calls an API route
-- that resolves the token server-side with the service key. So the anon key can
-- reach none of it, and a leaked token buys access to exactly one workbook
-- through one route rather than to the table.
--
-- An RLS-less table was caught here by an adversarial tester on 2026-07-30. Not
-- repeating it.
ALTER TABLE public.workbooks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbook_answers ENABLE ROW LEVEL SECURITY;

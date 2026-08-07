-- OFF-STRIPE PAYMENTS, step 1: the two tables that give members.billing_mode a consequence.
--
-- Design: docs/plans/off-stripe-payments-design.md (rulings D1-D7, 2026-08-07).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS MIGRATION TURNS NOTHING ON. Both tables land EMPTY and nothing writes to
-- them until a human creates an arrangement from the member drawer. The CHECK on
-- members.billing_mode is the only statement here that touches an existing table,
-- and it was written against the live values: 46 rows NULL, 2 rows 'alternate',
-- 0 rows anything else (counted 2026-08-07). 'card' is admitted because
-- api/sorter/cleanup.js writes it at promote (:869) and at Stripe-link (:491),
-- so a constraint without it would 400 the Sorter the next time it ran.
--
-- The drawer toggle writes the EMPTY STRING to mean "back to Stripe"
-- (public/client-portal.html:51779). That never reaches Postgres as '': the
-- update-profile action normalizes "" -> null before the write (api/members.js
-- actionUpdateProfile, "Empty string -> null"). The constraint below would
-- reject a literal '' - which is correct, and is why the normalization is
-- pinned by api/_off-card.test.mjs rather than left as an accident.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY TWO TABLES.
--   member_billing_arrangements = the RHYTHM and the TERMS. One live row per
--     member. It answers "how much, how often, starting when, who collects".
--   member_collections          = the thing that is DUE and the thing that gets
--     CLOSED. One row per expected period. It answers "was this one paid".
-- An action item is a to-do with no amount, no method and no paid-state, so it
-- can notify about a collection but can never BE one.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. members.billing_mode: one field, one answer (ruling D1).
--
-- Naming caveat, worth carrying: Stripe's own subscription object also has a
-- field called billing_mode (see api/stripe/webhook.js:507). Different
-- namespace, unrelated values. This column is OURS and means: how does this
-- academy take this member's money.
--   NULL / 'card' -> billed through Stripe.
--   'alternate'   -> pays outside Stripe (cash, e-transfer, cheque, bank).
-- Ruling D1 refused a second column for the same question. A CHECK is what makes
-- the single column trustworthy: without it, a typo ('alternative', 'Alternate')
-- reads as "billed by Stripe" everywhere and the member silently disappears from
-- the off-card world.
ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_billing_mode_check;
ALTER TABLE public.members
  ADD CONSTRAINT members_billing_mode_check
  CHECK (billing_mode IS NULL OR billing_mode IN ('alternate', 'card'));

-- members_staging carries the same flag through the Sorter (:444 writes
-- 'alternate', :491 writes 'card', :1095 writes null) and hands it to the member
-- row at promote. Same vocabulary or the promote can write a value the members
-- constraint refuses. Live staging values: 661 NULL, 1 'alternate'.
ALTER TABLE public.members_staging
  DROP CONSTRAINT IF EXISTS members_staging_billing_mode_check;
ALTER TABLE public.members_staging
  ADD CONSTRAINT members_staging_billing_mode_check
  CHECK (billing_mode IS NULL OR billing_mode IN ('alternate', 'card'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. member_billing_arrangements
CREATE TABLE IF NOT EXISTS public.member_billing_arrangements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- No FK to members, and no cascade. A member row is DELETED on cancellation in
  -- this system (see the cancellations table), and the arrangement is what the
  -- collections hang off - cascading it away would take the record of money a
  -- parent actually paid with it. Same reasoning member_receipts.member_id
  -- carries verbatim (20260731T190000_member_receipts.sql).
  member_id     uuid NOT NULL,
  -- Denormalized so an ended arrangement can still name who it was for after the
  -- member row is gone. Never joined on; display only.
  athlete_name  text,
  parent_name   text,

  -- HOW they pay. 'other' is admitted but never bare: without the follow-up you
  -- get "$85 other." and nobody can collect it (sj-price-match-log.md, the
  -- forgot-to-ask yield). The CHECK is the second half of the workbook's
  -- required follow-up box, so a direct POST cannot skip it either.
  method        text NOT NULL CHECK (method IN ('cash','e_transfer','bank_transfer','cheque','other')),
  method_note   text,
  CONSTRAINT member_billing_arrangements_other_needs_note
    CHECK (method <> 'other' OR COALESCE(btrim(method_note), '') <> ''),

  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  currency      text NOT NULL DEFAULT 'cad',

  -- WHERE THE RHYTHM CAME FROM, and why it is stored rather than re-derived.
  -- Plans get ARCHIVED (Lij archived Elementary while Ted and Jenny kept paying
  -- their $200 - archive is not cancel) and prices get EDITED. An arrangement
  -- that re-read the plan every run would stop, or silently re-phase, on either.
  -- So term + cadence are photographed onto the arrangement at activation.
  --
  -- term    - the commitment's IDENTITY, exactly as offer_price_key spells it:
  --           '4_weeks', 'monthly', '3_months', and ANY '<n>_months' the academy
  --           priced. There is no closed list here on purpose (ruling D5).
  -- cadence - offer_prices.billing_cadence when the row carried one, else NULL.
  --           NULL means "resolve from the term", byte-identical to how every
  --           live academy bills today.
  -- Both are fed to resolveInterval() in api/_billing-cadence.js, which is THE
  -- one place a billing interval is decided (shared with api/website/checkout.js,
  -- drift-guarded by api/_billing-cadence.test.mjs). Nothing here re-implements
  -- month or week arithmetic.
  offer_id        uuid,
  offer_price_key text,
  term            text,
  cadence         text,
  -- 'plan'     - resolved from the price row the member is on.
  -- 'override' - a human said the real rhythm differs from what was sold. Never
  --              reconciled silently; it surfaces as drift on the reconciliation
  --              report. The ARRANGEMENT wins for reminders, the PLAN wins for
  --              revenue expectation, and the disagreement stays visible.
  cadence_source  text NOT NULL DEFAULT 'plan' CHECK (cadence_source IN ('plan','override')),

  -- THE ANCHOR: the one fact the owner supplies that nothing else in the system
  -- knows. Two members on the same "every 4 weeks" plan pay in different weeks;
  -- a plan cannot tell you which. Period n is anchor + n intervals, always
  -- measured from the anchor, never from the previous due date - see the
  -- period_index comment on member_collections.
  anchor_date   date NOT NULL,

  -- Days after due_date before a collection flips 'due' -> 'overdue'.
  grace_days    integer NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 90),
  -- Days BEFORE due_date that the reminder action item is created. An item that
  -- appears four weeks early is an item the owner learns to ignore.
  lead_days     integer NOT NULL DEFAULT 3 CHECK (lead_days BETWEEN 0 AND 60),

  -- Ruling D2: the OWNER is the default assignee of every collect reminder and
  -- delegation is the exception. This column is the delegation, not the default:
  -- NULL means the owner, which is also what notifyOwners does anyway.
  collector_client_user_id uuid REFERENCES public.client_users(id) ON DELETE SET NULL,

  -- Stop generating past here and raise nothing automatically. An off-card
  -- member is never silently auto-renewed.
  commitment_end_date date,

  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  -- Paused arrangements skip generation. Collections already due stay due unless
  -- explicitly waived - a pause is not a forgiveness.
  resume_on     date,

  source        text NOT NULL DEFAULT 'staff' CHECK (source IN ('workbook','staff')),
  note          text,

  created_by      uuid,
  created_by_name text,
  ended_at        timestamptz,
  ended_reason    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ONE live arrangement per member. Two would generate two collections for the
-- same money and the owner would chase a parent twice. Ended ones are unlimited,
-- which is what makes off-card -> card -> off-card a history rather than an edit.
CREATE UNIQUE INDEX IF NOT EXISTS member_billing_arrangements_live_uk
  ON public.member_billing_arrangements (member_id)
  WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS member_billing_arrangements_client_idx
  ON public.member_billing_arrangements (client_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. member_collections
CREATE TABLE IF NOT EXISTS public.member_collections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Plain FK, NO cascade and NO set-null on purpose. Arrangements are ENDED,
  -- never deleted; if code ever tries to DELETE one that has collections,
  -- Postgres refuses rather than quietly erasing a payment history.
  arrangement_id uuid NOT NULL REFERENCES public.member_billing_arrangements(id),

  -- No FK to members, for the reason member_receipts gives verbatim: member rows
  -- are deleted on cancellation and a record of money a parent actually paid
  -- must outlive the membership. An academy that cannot produce last spring's
  -- collection because the athlete left has no ledger.
  member_id      uuid,
  athlete_name   text,
  parent_name    text,

  -- The period number, counted from the anchor. 1 = the anchor date itself.
  -- due_date for period n is addInterval(anchor, interval x n), computed from the
  -- ANCHOR every time and never from the previous due date. That is not a style
  -- choice: JS month arithmetic clamps, so a Jan-31 monthly anchor stepped one
  -- period at a time slides to Mar 3, then Apr 3, then May 3, and the parent's
  -- pay day drifts away from the pay day forever. Anchor-relative cannot drift.
  period_index   integer NOT NULL CHECK (period_index >= 1),
  due_date       date NOT NULL,

  amount_expected_cents  integer NOT NULL CHECK (amount_expected_cents >= 0),
  currency               text NOT NULL DEFAULT 'cad',

  -- 'partial' is a state, not a rounding error: amount_collected < amount_expected
  -- with the item still OPEN and the remainder still owed. It must never
  -- auto-close, which is the whole reason this is a status column and not a
  -- boolean paid flag.
  status         text NOT NULL DEFAULT 'due'
                 CHECK (status IN ('due','overdue','paid','partial','waived','void','disputed')),

  amount_collected_cents integer NOT NULL DEFAULT 0 CHECK (amount_collected_cents >= 0),
  -- The REAL date the money arrived, defaulting to today but editable, because
  -- cash arrives late and a ledger that records when someone got round to typing
  -- it in is a ledger of typing.
  collected_on   date,
  method         text,
  marked_by      uuid,
  marked_by_name text,
  marked_at      timestamptz,
  -- Free text: the e-transfer confirmation string, a cheque number. v1 proof of
  -- payment. File upload via member_files is the v1.1 shape.
  reference      text,
  note           text,

  -- The notification, not the record. The collection row is the truth and this
  -- is a copy; set null if the item is ever deleted out from under it.
  action_item_id uuid REFERENCES public.action_items(id) ON DELETE SET NULL,
  notified_at         timestamptz,
  -- due_soon_notified_at on action_items is a ONE-SHOT stamp, so an overdue
  -- re-ping needs its own or it never fires a second time.
  overdue_notified_at timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- THE IDEMPOTENCY GUARD. The generator runs on a cron; two overlapping runs, or
-- one run retried after a timeout, must not produce two rows for one period.
-- The guard is not in the application: the second INSERT is rejected by Postgres
-- (23505) and the generator reads that code and moves on. No read-then-write
-- window, the same posture the member_receipts send-once index takes.
CREATE UNIQUE INDEX IF NOT EXISTS member_collections_period_uk
  ON public.member_collections (arrangement_id, period_index);
CREATE INDEX IF NOT EXISTS member_collections_client_due_idx
  ON public.member_collections (client_id, status, due_date);
CREATE INDEX IF NOT EXISTS member_collections_member_idx
  ON public.member_collections (member_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at triggers (same shape as action_items / members)
CREATE OR REPLACE FUNCTION public.touch_off_card_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_member_billing_arrangements_updated_at ON public.member_billing_arrangements;
CREATE TRIGGER trg_member_billing_arrangements_updated_at
  BEFORE UPDATE ON public.member_billing_arrangements
  FOR EACH ROW EXECUTE FUNCTION public.touch_off_card_updated_at();

DROP TRIGGER IF EXISTS trg_member_collections_updated_at ON public.member_collections;
CREATE TRIGGER trg_member_collections_updated_at
  BEFORE UPDATE ON public.member_collections
  FOR EACH ROW EXECUTE FUNCTION public.touch_off_card_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS. Enabled with the same read policy members/member_audit_log carry: the
-- academy sees its own rows, staff see all. Every write in this build goes
-- through the service role (api/members.js), which bypasses RLS - these policies
-- are defense in depth for any direct authenticated read, and the absence of an
-- INSERT/UPDATE policy is deliberate: nobody edits a money row from a browser.
ALTER TABLE public.member_billing_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_billing_arrangements_select_own_or_staff ON public.member_billing_arrangements;
CREATE POLICY member_billing_arrangements_select_own_or_staff ON public.member_billing_arrangements
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

DROP POLICY IF EXISTS member_collections_select_own_or_staff ON public.member_collections;
CREATE POLICY member_collections_select_own_or_staff ON public.member_collections
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

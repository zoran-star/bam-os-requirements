-- MEMBER RECEIPTS - the schema behind the parent-facing receipt for money that moved.
--
-- Ships with api/_member-receipts.js, which is wired into api/stripe/webhook.js (a
-- paid invoice) and api/members.js actionRefund (a staff-issued refund).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS MIGRATION TURNS NOTHING ON. Read that twice before worrying about it.
--
-- `clients.receipt_mode` is nullable with NO default and there is NO backfill here.
-- NULL means OFF, and after this runs EVERY academy is NULL - so the number of
-- receipts sent the moment it lands is zero, and stays zero. The two academies that
-- actually get receipts are turned on by a SEPARATE data migration
-- (20260731T190100_seed_receipt_mode.sql), deliberately split out so the schema can
-- be applied without committing to who is live, and so turning academies on is a
-- reviewable one-line change rather than a side effect of a table definition.
--
-- V1 SAFETY. Independently of the above, the code refuses to do anything for an
-- academy whose clients.v2_access is not true. Both gates are in receiptModeFor()
-- in api/_member-receipts.js, and both are checked before any read of this table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE UNIQUE PARTIAL INDEX IS THE SEND-ONCE GUARD. It is the reason this table
-- exists in this shape.
--
-- Stripe fires BOTH `invoice.payment_succeeded` AND `invoice.paid` for a single
-- payment, milliseconds apart, and api/stripe/webhook.js routes both to the same
-- handler (see the dispatch, `case "invoice.paid"`). Any "have we already sent
-- this?" SELECT loses that race about as often as it wins it - this is the exact
-- shape that double-texted a real signup on 2026-07-12 and had to be fixed with a
-- compare-and-swap in activatePortalOnboardingMember.
--
-- So the guard is not in the application at all. The second INSERT is rejected by
-- Postgres (23505), the module reads that code, and reports "already receipted"
-- without sending. No lock, no ordering assumption, no read-then-write window.
--
-- It is PARTIAL (`WHERE kind = 'payment' AND stripe_invoice_id IS NOT NULL`) because
-- refund rows carry no invoice id and there can legitimately be several of them for
-- one member; a plain unique index would make the second partial refund impossible
-- to record.

CREATE TABLE IF NOT EXISTS public.member_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- No FK to members. A member row is DELETED on cancellation in this system (see
  -- the cancellations table), and a receipt for money a parent actually paid must
  -- outlive the membership - an academy that cannot produce last spring's receipt
  -- because the athlete left has no receipt system.
  member_id          uuid,
  kind               text NOT NULL CHECK (kind IN ('payment','refund')),
  receipt_number     text,
  stripe_invoice_id  text,
  stripe_charge_id   text,
  stripe_refund_id   text,
  amount_cents       integer NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'cad',
  -- The RENDER INPUTS, stored. items[] (plan / tax / signup fee), reconciled +
  -- reason, athlete, plan label, the date already formatted in the academy's zone,
  -- card brand + last4, the tax-registration line. A resend re-renders from THIS
  -- and never goes back to Stripe: a receipt is a document that was issued, and
  -- reproducing it must not depend on nobody having edited a price since.
  lines              jsonb,
  refund_of          uuid REFERENCES public.member_receipts(id) ON DELETE SET NULL,
  email_status       text CHECK (email_status IN ('sent','held','failed')),
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ⛔ THE SEND-ONCE GUARD. See the block above. Do not replace this with a check in
-- application code; that check is what this index exists because of.
CREATE UNIQUE INDEX IF NOT EXISTS member_receipts_payment_invoice_uniq
  ON public.member_receipts (client_id, stripe_invoice_id)
  WHERE kind = 'payment' AND stripe_invoice_id IS NOT NULL;

-- The member drawer's receipts list, and the 'first_only' mode's "has this member
-- ever been receipted" check.
CREATE INDEX IF NOT EXISTS member_receipts_member_idx
  ON public.member_receipts (client_id, member_id, created_at DESC);

-- Matching a refund back to the payment it reverses (both carry the charge id).
CREATE INDEX IF NOT EXISTS member_receipts_charge_idx
  ON public.member_receipts (client_id, stripe_charge_id);

-- The per-academy per-year number sequence reads the highest already issued.
CREATE INDEX IF NOT EXISTS member_receipts_number_idx
  ON public.member_receipts (client_id, receipt_number DESC);

COMMENT ON TABLE public.member_receipts IS
  'One row per receipt issued to a parent: a paid invoice (kind=payment) or a refund (kind=refund). The row is written BEFORE the email is sent and is never deleted on a send failure - email_status records what happened to the copy, not whether the money moved.';
COMMENT ON COLUMN public.member_receipts.lines IS
  'Stored render inputs. A resend re-renders from this row and never recomputes from Stripe. reconciled=false means the owner-typed base did not add up to the charged total, so the receipt states the total alone and reason names the drift for staff.';
COMMENT ON COLUMN public.member_receipts.email_status IS
  'sent | held | failed. held = api/_send.js declined to send AS the academy (no verified sending domain, or no public email for the unsubscribe link). The row still exists and staff can resend once setup is finished.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- ⛔ NOT OPTIONAL, AND NOT DEFENCE IN DEPTH ON THIS TABLE.
--
-- Every row here is per-family data belonging to ONE academy: the athlete's name,
-- what the parent paid, the last four digits of their card. The portal ships a
-- BROWSER Supabase client holding the anon key, so a table with RLS off is readable
-- by any authenticated session on default grants - which would mean any academy's
-- login could read every other academy's parents. There is no version of this table
-- that is safe without the two policies below.
--
-- Mirrors member_agreements in 20260726022703_signed_agreements.sql exactly, because
-- it is the same question about the same shape of data and two tables of parent PII
-- must not answer it two different ways: staff read/write everything, an academy
-- reads its OWN rows and writes none.
--
-- Every write in practice goes through the service-role API (api/_member-receipts.js
-- via api/stripe/webhook.js and api/members.js), which bypasses RLS - so these
-- policies cost the running system nothing and are purely about what the anon key
-- can reach. The reads the member drawer makes go through /api/members?action=receipts
-- for the same reason; the client_read policy is what keeps that a choice rather than
-- the only thing standing between one academy and another's receipts.
ALTER TABLE public.member_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_receipts_staff_rw ON public.member_receipts;
CREATE POLICY member_receipts_staff_rw ON public.member_receipts
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS member_receipts_client_read ON public.member_receipts;
CREATE POLICY member_receipts_client_read ON public.member_receipts
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.my_client_ids()));

-- ─── clients.receipt_mode ────────────────────────────────────────────────────
-- The whole feature switch, per academy, as DATA on the academy's own row. There is
-- no code path anywhere that asks which academy this is.
--
--   NULL          OFF. No receipts at all. Every academy, today.
--   'recurring'   a receipt for EVERY successful payment.
--   'first_only'  a receipt for the member's FIRST payment only.
--
-- Refunds are sent under BOTH modes and never under NULL: 'first_only' is a choice
-- about routine billing mail, and a refund is not routine.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS receipt_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_receipt_mode_check') THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_receipt_mode_check
      CHECK (receipt_mode IS NULL OR receipt_mode IN ('recurring','first_only'));
  END IF;
END $$;

COMMENT ON COLUMN public.clients.receipt_mode IS
  'NULL = receipts OFF for this academy (the default, and the state of every academy until somebody sets it). recurring = every successful payment. first_only = the first payment per member. Refunds send under both modes, never under NULL.';

-- ─── clients.tax_registration_number ─────────────────────────────────────────
-- Printed on the receipt by a tax academy that has one (GTA prints its HST number;
-- an academy in a no-tax jurisdiction has none).
--
-- EMPTY MEANS NO LINE. It does NOT mean printing the words "no tax" - that would be
-- a statement about somebody's tax position on a document a parent may hand to an
-- accountant, and it is not ours to make. Nullable, no default, no backfill.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_registration_number text;

COMMENT ON COLUMN public.clients.tax_registration_number IS
  'The academy''s tax registration number (e.g. a Canadian HST/GST number), printed on member receipts. NULL means the receipt carries no registration line - never the words "no tax".';

-- ─── clients.stripe_portal_url ───────────────────────────────────────────────
-- ALREADY SHIPPED by 20260731T090000, which carved this one column out of the
-- receipt system to unblock the welcome email's manage-membership link. Re-declared
-- here with IF NOT EXISTS so this migration is complete on its own and replays as a
-- no-op whichever of the two ran first - exactly as that file's header promised.
-- The receipt's manage-membership line reads the same column through the same
-- clientVars() -> {{location.portal_link}} path, so the two emails can never point
-- a parent at two different billing portals.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS stripe_portal_url text;

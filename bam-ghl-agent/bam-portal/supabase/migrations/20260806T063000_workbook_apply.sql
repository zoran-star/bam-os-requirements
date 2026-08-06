-- Step 5/6 columns for the workbook review-and-apply flow. All additive.
-- APPLIED to prod via Supabase MCP 2026-08-06 and read back; this file is the
-- record for fresh environments.
--
-- snapshot: the before-state of everything apply will touch (offer jsonb,
-- tax_config, offer_prices rows). Phase 3 is irreversible - a Stripe price can
-- be archived, never deleted - so the photograph is taken BEFORE the first
-- write, and it is the only way back.
ALTER TABLE public.workbooks ADD COLUMN IF NOT EXISTS snapshot jsonb;

-- approved_at/approved_by: the STAFF half of the two confirmations. The owner's
-- deliberate act is confirmed_at; staff's is approved_at. Different columns
-- because they are different people answering different questions - "this is
-- what I sell" versus "apply this to the live system" - and the apply gate
-- reads approved_at exactly the way the submit gate reads confirmed_at.
ALTER TABLE public.workbook_cards ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.workbook_cards ADD COLUMN IF NOT EXISTS approved_by uuid;

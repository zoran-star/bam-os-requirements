-- ============================================================
-- Pricing Catalog — BAM GTA seed
-- Portal Supabase project: jnojmfmpnsfmtqmwhopz
-- Run after pricing-catalog-schema.sql.
--
-- Seeds the BAM GTA academy's catalog from
--   /Users/zoransavic/BAM GTA/memories/plans-and-pricing.md
-- which is the source of truth for which Stripe prices are
-- canonical, lil-sale, or deprecated.
--
-- BAM GTA client_id:     39875f07-0a4b-4429-a201-2249bc1f24df
-- Stripe Connect acct:   acct_1P7kUCRxInSEtAh8
--
-- Idempotent — ON CONFLICT (client_id, stripe_price_id) DO UPDATE.
-- Re-run after editing plans-and-pricing.md to refresh classification.
-- ============================================================

INSERT INTO public.pricing_catalog (
  client_id, stripe_price_id, stripe_product_id, stripe_account_id,
  display_name, canonical_plan, tier, is_routable,
  amount_cents, currency, interval, hst_mode, notes
)
VALUES
  -- ─────────── Canonical monthly recurring (4-week, all-in) ───────────
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_ToNwa96lQ5I1Bs', 'prod_ToNw0LsfSksXgD', 'acct_1P7kUCRxInSEtAh8',
   'Steady',      '1/wk',   'canonical', true,  22600, 'cad', '4_weeks', 'all_in',
   '$200/mo marketing + 13% HST = $226 charged'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_ThYK86w2Zd8fp3', 'prod_ThYKhylhLqORpC', 'acct_1P7kUCRxInSEtAh8',
   'Accelerated', '2/wk',   'canonical', true,  31600, 'cad', '4_weeks', 'all_in',
   '$280/mo marketing + 13% HST = $316 charged'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_U3CUUJkzgyTjel', 'prod_U3BNEQwJfJ1rRN', 'acct_1P7kUCRxInSEtAh8',
   'Elevate',     '3/wk',   'canonical', true,  37800, 'cad', '4_weeks', 'all_in',
   '$335/mo marketing + 13% HST = $378 charged'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_U3CFSoR1LdyGlb', 'prod_TGtqWrP43SFT9A', 'acct_1P7kUCRxInSEtAh8',
   'Dominate',    'unlmtd', 'canonical', true,  63800, 'cad', '4_weeks', 'all_in',
   '$565/mo marketing + 13% HST = $638 charged'),

  -- ─────────── Lil-sale (canonical for grandfather/sale routing) ───────────
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_TdXYS4LMehFf3f', 'prod_TGtqWrP43SFT9A', 'acct_1P7kUCRxInSEtAh8',
   'Dominate (lil sale)', 'unlmtd', 'lil_sale', true,  39550, 'cad', '4_weeks', 'all_in',
   'PREFERRED lil-sale ID. $350 + HST = $395.50. Held by Asher, Emaad'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'plan_TGtqsnF6HzuIpZ', 'prod_TGtqWrP43SFT9A', 'acct_1P7kUCRxInSEtAh8',
   'Dominate (lil sale, variant)', 'unlmtd', 'lil_sale', false, 39550, 'cad', '4_weeks', 'all_in',
   'Functional duplicate. Skills should prefer plan_TdXYS4LMehFf3f. Held by Ahmad'),

  -- ─────────── One-time prepayment (pre-tax, auto-tax adds 13% HST) ───────────
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1SD3L5RxInSEtAh8FejEhM6T', 'prod_T9M3xxzrcWkQnJ', 'acct_1P7kUCRxInSEtAh8',
   '1/wk - 3 months', '1/wk', 'canonical', true,   54000, 'cad', '3_months', 'pre_tax',
   'Prepay 1/wk 3-month, $540 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1SD3NCRxInSEtAh8z5eiQZhT', 'prod_T9M5foMbesFlQx', 'acct_1P7kUCRxInSEtAh8',
   '1/wk - 6 months', '1/wk', 'canonical', true,  100000, 'cad', '6_months', 'pre_tax',
   'Prepay 1/wk 6-month, $1,000 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1SDBSFRxInSEtAh8ehOZL2Ns', 'prod_T9UR3VKoKmXGnm', 'acct_1P7kUCRxInSEtAh8',
   '2/wk - 3 months', '2/wk', 'canonical', true,   75600, 'cad', '3_months', 'pre_tax',
   'Prepay 2/wk 3-month, $756 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1SDBT3RxInSEtAh8wfPUB12W', 'prod_T9URBdTkCUl0bn', 'acct_1P7kUCRxInSEtAh8',
   '2/wk - 6 months', '2/wk', 'canonical', true,  140000, 'cad', '6_months', 'pre_tax',
   'Prepay 2/wk 6-month, $1,400 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1TVyMDRxInSEtAh8aSNNnbWd', 'prod_UUyIj45QN3bQRi', 'acct_1P7kUCRxInSEtAh8',
   '3/wk - 3 months', '3/wk', 'canonical', true,   90450, 'cad', '3_months', 'pre_tax',
   'Prepay 3/wk 3-month, $904.50 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1TVyMDRxInSEtAh8Uu1t5TNQ', 'prod_UUyIPeBXJK9A9w', 'acct_1P7kUCRxInSEtAh8',
   '3/wk - 6 months', '3/wk', 'canonical', true,  167500, 'cad', '6_months', 'pre_tax',
   'Prepay 3/wk 6-month, $1,675 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1TVyOGRxInSEtAh89fwIAEgc', 'prod_T9UuzXOj4G0cet', 'acct_1P7kUCRxInSEtAh8',
   'unlmtd - 3 months', 'unlmtd', 'canonical', true, 152550, 'cad', '3_months', 'pre_tax',
   'Prepay unlmtd 3-month, $1,525.50 pre-tax'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1TVyOHRxInSEtAh8K9uBlRoA', 'prod_T9Uu7XOT96n7DJ', 'acct_1P7kUCRxInSEtAh8',
   'unlmtd - 6 months', 'unlmtd', 'canonical', true, 282500, 'cad', '6_months', 'pre_tax',
   'Prepay unlmtd 6-month, $2,825 pre-tax'),

  -- ─────────── Deprecated (held by existing members only; do NOT route new) ───────────
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1SAdKIRxInSEtAh8uykNlSAD', 'prod_RThz2oZ4vY96Nb', 'acct_1P7kUCRxInSEtAh8',
   'Steady (50% off, deprecated)', '1/wk', 'deprecated', false, 10000, 'cad', '4_weeks', 'pre_tax',
   'Parker Li 50%-off Steady. active=false in Stripe. $100/4-week'),
  ('39875f07-0a4b-4429-a201-2249bc1f24df', 'price_1PVeLURxInSEtAh8OXDm9kuY', 'prod_QMN5mU16aPX8j0', 'acct_1P7kUCRxInSEtAh8',
   'Advanced (1 Month) @ 356 (deprecated)', '2/wk', 'deprecated', false, 35600, 'cad', '4_weeks', 'pre_tax',
   'Qundi Li old plan, superseded. Held only by legacy subs')

ON CONFLICT (client_id, stripe_price_id) DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_account_id = EXCLUDED.stripe_account_id,
  display_name      = EXCLUDED.display_name,
  canonical_plan    = EXCLUDED.canonical_plan,
  tier              = EXCLUDED.tier,
  is_routable       = EXCLUDED.is_routable,
  amount_cents      = EXCLUDED.amount_cents,
  currency          = EXCLUDED.currency,
  interval          = EXCLUDED.interval,
  hst_mode          = EXCLUDED.hst_mode,
  notes             = EXCLUDED.notes,
  last_synced_at    = now();

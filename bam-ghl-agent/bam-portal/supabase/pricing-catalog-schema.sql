-- ============================================================
-- Pricing Catalog — schema migration
-- Portal Supabase project: jnojmfmpnsfmtqmwhopz
-- Run this in the Supabase SQL Editor (or via supabase MCP apply_migration).
--
-- Per-academy catalog of Stripe prices on the academy's connected
-- Stripe account. Source of truth for which prices are sellable
-- (canonical / lil_sale → is_routable=true) vs frozen on existing
-- subs only (legacy_match / legacy_unknown / deprecated → is_routable=false).
--
-- Populated by:
--   1. Stripe webhook on price.created / price.updated (real-time)
--   2. On-demand sync from the Settings UI (optional, future)
--   3. Manual seed for BAM GTA (from BAM GTA/memories/plans-and-pricing.md)
--
-- Consumed by:
--   1. /change action — only routes new subs onto is_routable=true rows
--   2. customer.subscription.created webhook — derives members.plan
--      via canonical_plan instead of the hardcoded PRICE_TO_PLAN map
--   3. Members tab — surfaces "Legacy pricing" pill on roster cards
--      whose sub price has tier IN ('legacy_match','legacy_unknown')
--   4. Offers system (Training offer Pricing section) — shows catalog
--      rows grouped by canonical tier + collapsed Legacy subsection
--
-- Auto-tagging rule (in the price webhook):
--   - amount matches an existing canonical row for same client_id
--     → tier='legacy_match', canonical_plan inherited, is_routable=false
--   - no amount match → tier='legacy_unknown', is_routable=false
--   - Owners promote to tier='canonical' / 'lil_sale' manually in the UI.
--
-- Safe to re-run (idempotent).
-- ============================================================


-- ------------------------------------------------------------
-- 1. pricing_catalog table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_catalog (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Stripe identity
  stripe_price_id     TEXT NOT NULL,
  stripe_product_id   TEXT NOT NULL,
  stripe_account_id   TEXT,  -- denorm of clients.stripe_connect_account_id (fast filter)

  -- Classification
  display_name        TEXT,
  canonical_plan      TEXT
    CHECK (canonical_plan IN ('1/wk','2/wk','3/wk','unlmtd') OR canonical_plan IS NULL),
  tier                TEXT NOT NULL DEFAULT 'legacy_unknown'
    CHECK (tier IN ('canonical','lil_sale','legacy_match','legacy_unknown','deprecated')),
  is_routable         BOOLEAN NOT NULL DEFAULT false,

  -- Pricing facts (from Stripe)
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'cad',
  interval            TEXT,            -- '4_weeks' | '3_months' | '6_months' | 'one_time'
  hst_mode            TEXT
    CHECK (hst_mode IN ('all_in','pre_tax') OR hst_mode IS NULL),

  -- Misc
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, stripe_price_id)
);

-- ------------------------------------------------------------
-- 2. Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS pricing_catalog_routable_idx
  ON public.pricing_catalog (client_id, canonical_plan)
  WHERE is_routable = true;

CREATE INDEX IF NOT EXISTS pricing_catalog_tier_idx
  ON public.pricing_catalog (client_id, tier);

CREATE INDEX IF NOT EXISTS pricing_catalog_price_lookup_idx
  ON public.pricing_catalog (stripe_price_id);

-- ------------------------------------------------------------
-- 3. updated_at trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_pricing_catalog_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_catalog_updated_at ON public.pricing_catalog;
CREATE TRIGGER pricing_catalog_updated_at
  BEFORE UPDATE ON public.pricing_catalog
  FOR EACH ROW EXECUTE FUNCTION update_pricing_catalog_updated_at();

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
ALTER TABLE public.pricing_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_catalog_select ON public.pricing_catalog;
CREATE POLICY pricing_catalog_select ON public.pricing_catalog
  FOR SELECT
  USING (client_id IN (SELECT public.my_client_ids()));

-- Writes go through the API only (service role bypasses RLS).
-- No INSERT/UPDATE/DELETE policy for authenticated users.

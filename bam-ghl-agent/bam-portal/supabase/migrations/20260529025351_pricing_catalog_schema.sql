-- pricing_catalog: per-academy Stripe price catalog
CREATE TABLE IF NOT EXISTS public.pricing_catalog (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  stripe_price_id     TEXT NOT NULL,
  stripe_product_id   TEXT NOT NULL,
  stripe_account_id   TEXT,
  display_name        TEXT,
  canonical_plan      TEXT
    CHECK (canonical_plan IN ('1/wk','2/wk','3/wk','unlmtd') OR canonical_plan IS NULL),
  tier                TEXT NOT NULL DEFAULT 'legacy_unknown'
    CHECK (tier IN ('canonical','lil_sale','legacy_match','legacy_unknown','deprecated')),
  is_routable         BOOLEAN NOT NULL DEFAULT false,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'cad',
  interval            TEXT,
  hst_mode            TEXT
    CHECK (hst_mode IN ('all_in','pre_tax') OR hst_mode IS NULL),
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, stripe_price_id)
);

CREATE INDEX IF NOT EXISTS pricing_catalog_routable_idx
  ON public.pricing_catalog (client_id, canonical_plan)
  WHERE is_routable = true;
CREATE INDEX IF NOT EXISTS pricing_catalog_tier_idx
  ON public.pricing_catalog (client_id, tier);
CREATE INDEX IF NOT EXISTS pricing_catalog_price_lookup_idx
  ON public.pricing_catalog (stripe_price_id);

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

ALTER TABLE public.pricing_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_catalog_select ON public.pricing_catalog;
CREATE POLICY pricing_catalog_select ON public.pricing_catalog
  FOR SELECT
  USING (client_id IN (SELECT public.my_client_ids()));;

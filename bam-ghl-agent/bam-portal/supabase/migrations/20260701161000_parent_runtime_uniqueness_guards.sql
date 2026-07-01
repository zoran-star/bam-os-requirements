-- Parent runtime uniqueness guards.
--
-- These indexes make offer/runtime syncs, imports, and Stripe webhook retries
-- safe to rerun. They intentionally avoid a unique constraint on
-- offer_prices.source_offer_price_key because current and legacy prices can
-- share the same Business Blueprint key while pointing at different Stripe /
-- pricing_catalog rows.

DO $$
DECLARE
    duplicate_keys jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            source_offer_id,
            source_offer_option_key,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.offer_options
        WHERE source_offer_id IS NOT NULL
          AND source_offer_option_key IS NOT NULL
          AND status <> 'ARCHIVED'
        GROUP BY tenant_id, source_offer_id, source_offer_option_key
        HAVING count(*) > 1
        ORDER BY tenant_id, source_offer_id, source_offer_option_key
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_offer_options_source_option_live; duplicate non-archived source options: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            source_offer_team_id,
            source_offer_team_key,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.offer_options
        WHERE source_offer_team_id IS NOT NULL
          AND source_offer_team_key IS NOT NULL
        GROUP BY tenant_id, source_offer_team_id, source_offer_team_key
        HAVING count(*) > 1
        ORDER BY tenant_id, source_offer_team_id, source_offer_team_key
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_offer_options_source_team; duplicate source team options: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            stripe_price_id,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.offer_prices
        WHERE stripe_price_id IS NOT NULL
        GROUP BY tenant_id, stripe_price_id
        HAVING count(*) > 1
        ORDER BY tenant_id, stripe_price_id
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_offer_prices_stripe_price; duplicate Stripe prices: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            source_pricing_catalog_id,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.offer_prices
        WHERE source_pricing_catalog_id IS NOT NULL
        GROUP BY tenant_id, source_pricing_catalog_id
        HAVING count(*) > 1
        ORDER BY tenant_id, source_pricing_catalog_id
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_offer_prices_source_catalog; duplicate pricing_catalog links: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            offer_price_id,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.entitlement_templates
        WHERE status = 'ACTIVE'
        GROUP BY tenant_id, offer_price_id
        HAVING count(*) > 1
        ORDER BY tenant_id, offer_price_id
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_entitlement_templates_active_price; duplicate active templates: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            source,
            source_ref,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.customer_entitlements
        WHERE source_ref IS NOT NULL
        GROUP BY tenant_id, source, source_ref
        HAVING count(*) > 1
        ORDER BY tenant_id, source, source_ref
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_customer_entitlements_source_ref; duplicate entitlement source refs: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            customer_entitlement_id,
            source,
            source_ref,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.credit_ledger
        WHERE source = 'stripe'
          AND entry_type = 'GRANT'
          AND source_ref IS NOT NULL
        GROUP BY tenant_id, customer_entitlement_id, source, source_ref
        HAVING count(*) > 1
        ORDER BY tenant_id, customer_entitlement_id, source, source_ref
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_credit_ledger_stripe_grant; duplicate Stripe grant ledger refs: %', duplicate_keys;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_options_source_option_live
    ON public.offer_options USING btree (tenant_id, source_offer_id, source_offer_option_key)
    WHERE source_offer_id IS NOT NULL
      AND source_offer_option_key IS NOT NULL
      AND status <> 'ARCHIVED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_options_source_team
    ON public.offer_options USING btree (tenant_id, source_offer_team_id, source_offer_team_key)
    WHERE source_offer_team_id IS NOT NULL
      AND source_offer_team_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_prices_stripe_price
    ON public.offer_prices USING btree (tenant_id, stripe_price_id)
    WHERE stripe_price_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_prices_source_catalog
    ON public.offer_prices USING btree (tenant_id, source_pricing_catalog_id)
    WHERE source_pricing_catalog_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_templates_active_price
    ON public.entitlement_templates USING btree (tenant_id, offer_price_id)
    WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_entitlements_source_ref
    ON public.customer_entitlements USING btree (tenant_id, source, source_ref)
    WHERE source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_stripe_grant
    ON public.credit_ledger USING btree (tenant_id, customer_entitlement_id, source, source_ref)
    WHERE source = 'stripe'
      AND entry_type = 'GRANT'
      AND source_ref IS NOT NULL;

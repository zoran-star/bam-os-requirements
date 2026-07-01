-- Parent legacy Steady price entitlement source.
--
-- Aarnav has a live Stripe subscription on this legacy/non-routable Stripe
-- price. Keep it out of checkout, but make it addressable by the later
-- customer_entitlements import.

BEGIN;

WITH tenant AS (
    SELECT id
    FROM public.clients
    WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid
),
legacy_catalog AS (
    SELECT pc.*
    FROM public.pricing_catalog pc
    JOIN tenant ON tenant.id = pc.client_id
    WHERE pc.id = '8b5790fb-6e0a-42e9-85d8-914f49fca2b7'::uuid
      AND pc.stripe_price_id = 'price_1Rr8OjRxInSEtAh8GESeALQG'
),
steady_option AS (
    SELECT oo.id, oo.tenant_id
    FROM public.offer_options oo
    JOIN tenant ON tenant.id = oo.tenant_id
    WHERE oo.id = '81000000-0000-4000-8000-000000000001'::uuid
)
INSERT INTO public.offer_prices (
    id,
    tenant_id,
    offer_option_id,
    title,
    amount_cents,
    currency,
    billing_interval,
    stripe_price_id,
    stripe_product_id,
    source_offer_id,
    source_offer_price_key,
    source_pricing_catalog_id,
    is_active,
    is_routable,
    show_on_onboarding,
    sort_order
)
SELECT
    '82000000-0000-4000-8000-000000000007'::uuid,
    steady_option.tenant_id,
    steady_option.id,
    '1/Wk - 3 months (legacy)',
    legacy_catalog.amount_cents,
    legacy_catalog.currency,
    legacy_catalog.interval,
    legacy_catalog.stripe_price_id,
    legacy_catalog.stripe_product_id,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    'Steady|3_months',
    legacy_catalog.id,
    false,
    false,
    false,
    70
FROM steady_option
JOIN legacy_catalog ON legacy_catalog.client_id = steady_option.tenant_id
ON CONFLICT (id) DO UPDATE SET
    tenant_id = excluded.tenant_id,
    offer_option_id = excluded.offer_option_id,
    title = excluded.title,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    billing_interval = excluded.billing_interval,
    stripe_price_id = excluded.stripe_price_id,
    stripe_product_id = excluded.stripe_product_id,
    source_offer_id = excluded.source_offer_id,
    source_offer_price_key = excluded.source_offer_price_key,
    source_pricing_catalog_id = excluded.source_pricing_catalog_id,
    is_active = excluded.is_active,
    is_routable = excluded.is_routable,
    show_on_onboarding = excluded.show_on_onboarding,
    sort_order = excluded.sort_order,
    updated_at = now();

WITH tenant AS (
    SELECT id
    FROM public.clients
    WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid
),
program AS (
    SELECT bp.id, bp.tenant_id
    FROM public.bookable_programs bp
    JOIN tenant ON tenant.id = bp.tenant_id
    WHERE bp.source_program_key = 'bam-gta-training'
),
legacy_price AS (
    SELECT op.id, op.tenant_id
    FROM public.offer_prices op
    JOIN tenant ON tenant.id = op.tenant_id
    WHERE op.id = '82000000-0000-4000-8000-000000000007'::uuid
)
INSERT INTO public.entitlement_templates (
    id,
    tenant_id,
    offer_price_id,
    bookable_program_id,
    entitlement_kind,
    scope_type,
    credits_per_period,
    credit_period,
    is_unlimited,
    credit_cost_policy,
    config,
    status
)
SELECT
    '83000000-0000-4000-8000-000000000007'::uuid,
    legacy_price.tenant_id,
    legacy_price.id,
    program.id,
    'WEEKLY_CREDITS',
    'STUDENT',
    1,
    'WEEK',
    false,
    'PER_SLOT_CREDIT_COST',
    '{"display_label":"1 credit / week"}'::jsonb,
    'ACTIVE'
FROM legacy_price
JOIN program ON program.tenant_id = legacy_price.tenant_id
ON CONFLICT (id) DO UPDATE SET
    tenant_id = excluded.tenant_id,
    offer_price_id = excluded.offer_price_id,
    bookable_program_id = excluded.bookable_program_id,
    entitlement_kind = excluded.entitlement_kind,
    scope_type = excluded.scope_type,
    credits_per_period = excluded.credits_per_period,
    credit_period = excluded.credit_period,
    is_unlimited = excluded.is_unlimited,
    credit_cost_policy = excluded.credit_cost_policy,
    config = excluded.config,
    status = excluded.status,
    updated_at = now();

COMMIT;

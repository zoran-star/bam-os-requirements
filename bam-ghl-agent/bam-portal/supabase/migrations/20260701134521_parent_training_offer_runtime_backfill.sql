-- Parent training offer runtime backfill.
--
-- Moves the current BAM GTA sellable training membership shape into the typed
-- parent runtime tables. This migration intentionally does not grant member
-- entitlements; identity/member import is a separate step.

-- Ensure the access target exists when this runs against production data.
INSERT INTO public.bookable_programs (
    id,
    tenant_id,
    source_program_key,
    title,
    program_type,
    status,
    description,
    sort_order,
    config
)
SELECT
    '80000000-0000-4000-8000-000000000001'::uuid,
    c.id,
    'bam-gta-training',
    'BAM GTA Training',
    'TRAINING',
    'ACTIVE',
    'Training classes and shooting sessions for BAM GTA.',
    10,
    '{"seed":"parent_training_offer_runtime_backfill"}'::jsonb
FROM public.clients c
WHERE c.id = '39875f07-0a4b-4429-a201-2249bc1f24df'
ON CONFLICT (tenant_id, source_program_key) DO UPDATE SET
    title = excluded.title,
    program_type = excluded.program_type,
    status = excluded.status,
    description = excluded.description,
    sort_order = excluded.sort_order,
    config = excluded.config,
    updated_at = now();

-- Zoran moved the live 1/Wk 3-month price to this Stripe price. The older
-- 8b5790fb catalog row remains a legacy/non-routable row for historical subs.
UPDATE public.pricing_catalog
SET
    offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    offer_price_key = 'Steady|3_months',
    match_status = 'confirmed',
    match_confidence = 1,
    match_source = 'manual',
    matched_at = COALESCE(matched_at, now()),
    is_routable = true,
    updated_at = now()
WHERE id = 'e9ad2a0c-6653-4707-a1af-201d45c8364e'::uuid
  AND client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid;

WITH tenant AS (
    SELECT id
    FROM public.clients
    WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid
),
rows (
    id,
    title,
    description,
    source_offer_option_key,
    sort_order
) AS (
    VALUES
        (
            '81000000-0000-4000-8000-000000000001'::uuid,
            '1/Wk',
            'One training credit per week.',
            'Steady',
            10
        ),
        (
            '81000000-0000-4000-8000-000000000003'::uuid,
            'Summer Unlimited',
            'Unlimited training bookings for the summer offer.',
            'Summer Unlimited',
            20
        )
)
INSERT INTO public.offer_options (
    id,
    tenant_id,
    title,
    offer_type,
    purchase_kind,
    status,
    description,
    source_offer_id,
    source_offer_option_key,
    sort_order
)
SELECT
    rows.id,
    tenant.id,
    rows.title,
    'TRAINING',
    'MEMBERSHIP',
    'ACTIVE',
    rows.description,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    rows.source_offer_option_key,
    rows.sort_order
FROM rows
CROSS JOIN tenant
ON CONFLICT (id) DO UPDATE SET
    tenant_id = excluded.tenant_id,
    title = excluded.title,
    offer_type = excluded.offer_type,
    purchase_kind = excluded.purchase_kind,
    status = excluded.status,
    description = excluded.description,
    source_offer_id = excluded.source_offer_id,
    source_offer_option_key = excluded.source_offer_option_key,
    sort_order = excluded.sort_order,
    updated_at = now();

-- Retire the previous local-only Accelerate fixture if it exists in any
-- environment. This keeps the active runtime set to the five sellable prices.
UPDATE public.offer_options
SET
    status = 'ARCHIVED',
    source_offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    source_offer_option_key = 'Accelerate',
    updated_at = now()
WHERE id = '81000000-0000-4000-8000-000000000002'::uuid
  AND tenant_id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid;

WITH tenant AS (
    SELECT id
    FROM public.clients
    WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid
),
rows (
    id,
    offer_option_id,
    title,
    source_offer_price_key,
    source_pricing_catalog_id,
    show_on_onboarding,
    sort_order
) AS (
    VALUES
        (
            '82000000-0000-4000-8000-000000000001'::uuid,
            '81000000-0000-4000-8000-000000000001'::uuid,
            '1/Wk - Monthly',
            'Steady|monthly',
            '19515c88-2c61-46b1-b9a9-9da7bc849ca8'::uuid,
            true,
            10
        ),
        (
            '82000000-0000-4000-8000-000000000004'::uuid,
            '81000000-0000-4000-8000-000000000001'::uuid,
            '1/Wk - 3 months',
            'Steady|3_months',
            'e9ad2a0c-6653-4707-a1af-201d45c8364e'::uuid,
            false,
            20
        ),
        (
            '82000000-0000-4000-8000-000000000005'::uuid,
            '81000000-0000-4000-8000-000000000001'::uuid,
            '1/Wk - 6 months',
            'Steady|6_months',
            '20152e0a-9032-4306-b3b8-a0148d467c33'::uuid,
            false,
            30
        ),
        (
            '82000000-0000-4000-8000-000000000003'::uuid,
            '81000000-0000-4000-8000-000000000003'::uuid,
            'Summer Unlimited - Monthly',
            'Summer Unlimited|monthly',
            'ed4fec70-2e13-448a-8ad1-744841be7ad9'::uuid,
            true,
            40
        ),
        (
            '82000000-0000-4000-8000-000000000006'::uuid,
            '81000000-0000-4000-8000-000000000003'::uuid,
            'Summer Unlimited - 3 months',
            'Summer Unlimited|3_months',
            'a0bf4dd4-29c6-4cfd-b816-ff49b3a485ec'::uuid,
            true,
            50
        )
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
    rows.id,
    tenant.id,
    rows.offer_option_id,
    rows.title,
    pc.amount_cents,
    pc.currency,
    pc.interval,
    pc.stripe_price_id,
    pc.stripe_product_id,
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    rows.source_offer_price_key,
    pc.id,
    true,
    true,
    rows.show_on_onboarding,
    rows.sort_order
FROM rows
JOIN tenant ON true
JOIN public.offer_options oo
  ON oo.id = rows.offer_option_id
 AND oo.tenant_id = tenant.id
JOIN public.pricing_catalog pc
  ON pc.id = rows.source_pricing_catalog_id
 AND pc.client_id = tenant.id
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

UPDATE public.offer_prices
SET
    is_active = false,
    is_routable = false,
    show_on_onboarding = false,
    source_offer_id = '52a6285c-7832-44e1-b531-ab7ef9d8fc21'::uuid,
    source_offer_price_key = 'Accelerate|monthly',
    source_pricing_catalog_id = 'e67f4504-43b9-46ff-932c-8f4967af678d'::uuid,
    updated_at = now()
WHERE id = '82000000-0000-4000-8000-000000000002'::uuid
  AND tenant_id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid;

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
rows (
    id,
    offer_price_id,
    entitlement_kind,
    credits_per_period,
    credit_period,
    is_unlimited,
    credit_cost_policy,
    config
) AS (
    VALUES
        (
            '83000000-0000-4000-8000-000000000001'::uuid,
            '82000000-0000-4000-8000-000000000001'::uuid,
            'WEEKLY_CREDITS',
            1,
            'WEEK',
            false,
            'PER_SLOT_CREDIT_COST',
            '{"display_label":"1 credit / week"}'::jsonb
        ),
        (
            '83000000-0000-4000-8000-000000000004'::uuid,
            '82000000-0000-4000-8000-000000000004'::uuid,
            'WEEKLY_CREDITS',
            1,
            'WEEK',
            false,
            'PER_SLOT_CREDIT_COST',
            '{"display_label":"1 credit / week"}'::jsonb
        ),
        (
            '83000000-0000-4000-8000-000000000005'::uuid,
            '82000000-0000-4000-8000-000000000005'::uuid,
            'WEEKLY_CREDITS',
            1,
            'WEEK',
            false,
            'PER_SLOT_CREDIT_COST',
            '{"display_label":"1 credit / week"}'::jsonb
        ),
        (
            '83000000-0000-4000-8000-000000000003'::uuid,
            '82000000-0000-4000-8000-000000000003'::uuid,
            'UNLIMITED_BOOKING',
            null,
            null,
            true,
            'FREE',
            '{"display_label":"Unlimited bookings"}'::jsonb
        ),
        (
            '83000000-0000-4000-8000-000000000006'::uuid,
            '82000000-0000-4000-8000-000000000006'::uuid,
            'UNLIMITED_BOOKING',
            null,
            null,
            true,
            'FREE',
            '{"display_label":"Unlimited bookings"}'::jsonb
        )
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
    rows.id,
    program.tenant_id,
    rows.offer_price_id,
    program.id,
    rows.entitlement_kind,
    'STUDENT',
    rows.credits_per_period,
    rows.credit_period,
    rows.is_unlimited,
    rows.credit_cost_policy,
    rows.config,
    'ACTIVE'
FROM rows
JOIN program ON true
JOIN public.offer_prices op
  ON op.id = rows.offer_price_id
 AND op.tenant_id = program.tenant_id
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

UPDATE public.entitlement_templates
SET
    status = 'ARCHIVED',
    updated_at = now()
WHERE id = '83000000-0000-4000-8000-000000000002'::uuid
  AND tenant_id = '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid;

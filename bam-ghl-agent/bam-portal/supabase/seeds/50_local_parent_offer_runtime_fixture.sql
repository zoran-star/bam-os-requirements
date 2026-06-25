-- Local development seed: parent-owned Offer runtime fixture for BAM GTA.
--
-- Phase-one parent app runtime uses these tables directly. The shared
-- Business Blueprint tables (`offers`, `offer_teams`, `pricing_catalog`) are
-- seeded separately to mirror prod and remain only nullable lineage targets.

insert into public.offer_options (
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
values
  (
    '81000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Steady',
    'TRAINING',
    'MEMBERSHIP',
    'ACTIVE',
    '1 training credit per week.',
    null,
    null,
    10
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Accelerate',
    'TRAINING',
    'MEMBERSHIP',
    'ACTIVE',
    '2 training credits per week.',
    null,
    null,
    20
  ),
  (
    '81000000-0000-4000-8000-000000000003',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'Summer Unlimited',
    'TRAINING',
    'MEMBERSHIP',
    'ACTIVE',
    'Unlimited training credits for the summer offer.',
    null,
    null,
    30
  )
on conflict (id) do update set
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

insert into public.offer_prices (
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
  sort_order
)
values
  (
    '82000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '81000000-0000-4000-8000-000000000001',
    'Steady · Monthly',
    22600,
    'cad',
    '4_weeks',
    'plan_ToNwa96lQ5I1Bs',
    'prod_ToNw0LsfSksXgD',
    null,
    null,
    null,
    true,
    true,
    10
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '81000000-0000-4000-8000-000000000002',
    'Accelerate · Monthly',
    31600,
    'cad',
    '4_weeks',
    'plan_ThYK86w2Zd8fp3',
    'prod_ThYKhylhLqORpC',
    null,
    null,
    null,
    true,
    true,
    20
  ),
  (
    '82000000-0000-4000-8000-000000000003',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '81000000-0000-4000-8000-000000000003',
    'Summer Unlimited · Monthly',
    31527,
    'cad',
    '4_weeks',
    'price_1Ti6PCRxInSEtAh89gUsOSFj',
    'prod_UhVQFSJvuXszDk',
    null,
    null,
    null,
    true,
    true,
    30
  )
on conflict (id) do update set
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
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.entitlement_templates (
  id,
  tenant_id,
  offer_price_id,
  entitlement_kind,
  scope_type,
  credits_per_period,
  credit_period,
  is_unlimited,
  credit_cost_policy,
  config,
  status
)
values
  (
    '83000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '82000000-0000-4000-8000-000000000001',
    'WEEKLY_CREDITS',
    'STUDENT',
    1,
    'WEEK',
    false,
    'PER_SLOT_CREDIT_COST',
    '{"display_label":"1 credit / week"}'::jsonb,
    'ACTIVE'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '82000000-0000-4000-8000-000000000002',
    'WEEKLY_CREDITS',
    'STUDENT',
    2,
    'WEEK',
    false,
    'PER_SLOT_CREDIT_COST',
    '{"display_label":"2 credits / week"}'::jsonb,
    'ACTIVE'
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '82000000-0000-4000-8000-000000000003',
    'UNLIMITED_BOOKING',
    'STUDENT',
    null,
    null,
    true,
    'FREE',
    '{"display_label":"Unlimited bookings"}'::jsonb,
    'ACTIVE'
  )
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  offer_price_id = excluded.offer_price_id,
  entitlement_kind = excluded.entitlement_kind,
  scope_type = excluded.scope_type,
  credits_per_period = excluded.credits_per_period,
  credit_period = excluded.credit_period,
  is_unlimited = excluded.is_unlimited,
  credit_cost_policy = excluded.credit_cost_policy,
  config = excluded.config,
  status = excluded.status,
  updated_at = now();

insert into public.customer_entitlements (
  id,
  tenant_id,
  academy_membership_id,
  customer_id,
  student_id,
  scope_type,
  scope_id,
  entitlement_kind,
  status,
  valid_from,
  valid_until,
  source,
  source_offer_price_id,
  source_entitlement_template_id,
  source_ref,
  config
)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f',
    null,
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    'STUDENT',
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    'WEEKLY_CREDITS',
    'ACTIVE',
    date_trunc('week', now()),
    null,
    'seed',
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'local-seed:maya-steady',
    '{"credits_per_period":1,"credit_period":"WEEK"}'::jsonb
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '6543bff1-4f54-4760-a82f-2c0d210ec27d',
    null,
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    'STUDENT',
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    'WEEKLY_CREDITS',
    'SUSPENDED',
    date_trunc('week', now()) - interval '3 weeks',
    null,
    'seed',
    '82000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000002',
    'local-seed:leo-accelerate',
    '{"credits_per_period":2,"credit_period":"WEEK"}'::jsonb
  ),
  (
    '84000000-0000-4000-8000-000000000003',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'a5ac9fd2-8d34-456a-8b56-1ae457f256f4',
    null,
    'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825',
    'STUDENT',
    'ccfd4c6a-9e7a-41f4-8d7a-8f6e80e69825',
    'UNLIMITED_BOOKING',
    'ACTIVE',
    date_trunc('week', now()),
    null,
    'seed',
    '82000000-0000-4000-8000-000000000003',
    '83000000-0000-4000-8000-000000000003',
    'local-seed:noah-summer-unlimited',
    '{"is_unlimited":true}'::jsonb
  )
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  academy_membership_id = excluded.academy_membership_id,
  customer_id = excluded.customer_id,
  student_id = excluded.student_id,
  scope_type = excluded.scope_type,
  scope_id = excluded.scope_id,
  entitlement_kind = excluded.entitlement_kind,
  status = excluded.status,
  valid_from = excluded.valid_from,
  valid_until = excluded.valid_until,
  source = excluded.source,
  source_offer_price_id = excluded.source_offer_price_id,
  source_entitlement_template_id = excluded.source_entitlement_template_id,
  source_ref = excluded.source_ref,
  config = excluded.config,
  updated_at = now();

insert into public.credit_ledger (
  id,
  tenant_id,
  customer_entitlement_id,
  academy_membership_id,
  student_id,
  reservation_id,
  entry_type,
  credit_delta,
  effective_at,
  source,
  source_ref,
  notes,
  metadata
)
values
  (
    '85000000-0000-4000-8000-000000000001',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '84000000-0000-4000-8000-000000000001',
    '8f4f7dc6-a0ab-4549-95e5-7e6e32c2da8f',
    '531a0580-56c6-4029-a72f-c42221e17bfb',
    null,
    'GRANT',
    4,
    date_trunc('week', now()),
    'seed',
    'local-seed:maya-opening-balance',
    'Opening balance for local Steady fixture.',
    '{"grant_reason":"opening_balance"}'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    '84000000-0000-4000-8000-000000000002',
    '6543bff1-4f54-4760-a82f-2c0d210ec27d',
    '5c0bf246-1612-4e82-8aca-4fba43e13f6e',
    null,
    'GRANT',
    8,
    date_trunc('week', now()) - interval '3 weeks',
    'seed',
    'local-seed:leo-opening-balance',
    'Opening balance for local suspended Accelerate fixture.',
    '{"grant_reason":"opening_balance"}'::jsonb
  )
on conflict (id) do nothing;

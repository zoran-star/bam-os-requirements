-- Operational parent customer entitlement backfill.
--
-- This is intentionally NOT a numbered Supabase migration. It is production
-- data-dependent and should be run manually after reviewing the read-only
-- report:
--   supabase db query --linked -f scripts/migration/parent-customer-entitlement-backfill-report.sql
--
-- The script creates active customer_entitlements from the identity spine:
--   members -> member_links -> students -> academy_memberships
--
-- Routable Stripe-backed memberships map through:
--   members.stripe_price_id -> pricing_catalog -> offer_prices -> entitlement_templates
--
-- Stefan's manual/offline Summer Unlimited membership is mapped explicitly to
-- the Summer Unlimited template but uses source='manual'. This keeps the
-- entitlement behavior aligned with Summer Unlimited without pretending a
-- Stripe subscription exists.
--
-- Credit-bearing entitlements also receive an opening GRANT ledger row. The
-- current booking RPC uses the ledger balance directly, so a WEEKLY_CREDITS
-- entitlement without an opening grant would not be bookable.
-- WEEKLY_CREDITS receives 4 credits as the opening current-month balance for
-- the existing 1/Wk / 4-sessions-per-month offer shape.

WITH constants AS (
  SELECT
    '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid AS tenant_id,
    '958357cb-498a-4f2c-b295-62dcb5335d26'::uuid AS manual_summer_member_id,
    '82000000-0000-4000-8000-000000000003'::uuid AS manual_summer_offer_price_id
),
linked_members AS (
  SELECT
    m.*,
    ml.student_id,
    s.parent_id AS customer_id,
    am.id AS academy_membership_id,
    COALESCE(m.stripe_joined_at, m.joined_date::timestamptz, m.created_at, now()) AS effective_joined_at
  FROM public.members m
  JOIN constants c ON c.tenant_id = m.client_id
  JOIN public.member_links ml ON ml.member_id = m.id
  JOIN public.students s ON s.id = ml.student_id
  JOIN public.academy_memberships am
    ON am.student_id = s.id
   AND am.academy_id = m.client_id
  WHERE m.status = 'live'
),
stripe_candidates AS (
  SELECT DISTINCT ON (lm.id, et.bookable_program_id)
    lm.id AS member_id,
    lm.academy_membership_id,
    lm.customer_id,
    lm.student_id,
    op.id AS offer_price_id,
    op.title AS offer_price_title,
    et.id AS entitlement_template_id,
    et.bookable_program_id,
    et.entitlement_kind,
    et.scope_type,
    et.credits_per_period,
    et.credit_period,
    et.is_unlimited,
    et.credit_cost_policy,
    et.config,
    'import'::text AS source,
    'parent-entitlement-import:member:' || lm.id::text AS source_ref,
    lm.effective_joined_at
  FROM linked_members lm
  JOIN public.pricing_catalog pc
    ON pc.client_id = lm.client_id
   AND pc.stripe_price_id = lm.stripe_price_id
  JOIN public.offer_prices op
    ON op.source_pricing_catalog_id = pc.id
   AND op.tenant_id = pc.client_id
  JOIN public.entitlement_templates et
    ON et.offer_price_id = op.id
   AND et.tenant_id = op.tenant_id
   AND et.status = 'ACTIVE'
  JOIN public.bookable_programs bp
    ON bp.id = et.bookable_program_id
   AND bp.tenant_id = et.tenant_id
   AND bp.status = 'ACTIVE'
  WHERE lm.id <> (SELECT manual_summer_member_id FROM constants)
  ORDER BY lm.id, et.bookable_program_id, op.is_active DESC, op.is_routable DESC, op.sort_order NULLS LAST, op.id
),
manual_summer_candidates AS (
  SELECT
    lm.id AS member_id,
    lm.academy_membership_id,
    lm.customer_id,
    lm.student_id,
    op.id AS offer_price_id,
    op.title AS offer_price_title,
    et.id AS entitlement_template_id,
    et.bookable_program_id,
    et.entitlement_kind,
    et.scope_type,
    et.credits_per_period,
    et.credit_period,
    et.is_unlimited,
    et.credit_cost_policy,
    et.config || jsonb_build_object('manual_offline', true) AS config,
    'manual'::text AS source,
    'parent-entitlement-import:manual-member:' || lm.id::text AS source_ref,
    lm.effective_joined_at
  FROM linked_members lm
  JOIN constants c
    ON c.manual_summer_member_id = lm.id
  JOIN public.offer_prices op
    ON op.id = c.manual_summer_offer_price_id
   AND op.tenant_id = lm.client_id
  JOIN public.entitlement_templates et
    ON et.offer_price_id = op.id
   AND et.tenant_id = op.tenant_id
   AND et.status = 'ACTIVE'
  JOIN public.bookable_programs bp
    ON bp.id = et.bookable_program_id
   AND bp.tenant_id = et.tenant_id
   AND bp.status = 'ACTIVE'
),
candidate_entitlements AS (
  SELECT * FROM stripe_candidates
  UNION ALL
  SELECT * FROM manual_summer_candidates
),
candidate_rows AS (
  SELECT
    md5('parent-customer-entitlement:' || member_id::text || ':' || bookable_program_id::text)::uuid AS customer_entitlement_id,
    *
  FROM candidate_entitlements
),
conflicting_active_entitlements AS (
  SELECT DISTINCT
    c.member_id,
    c.academy_membership_id,
    c.bookable_program_id
  FROM candidate_rows c
  JOIN public.customer_entitlements ce
    ON ce.tenant_id = (SELECT tenant_id FROM constants)
   AND ce.academy_membership_id = c.academy_membership_id
   AND ce.bookable_program_id = c.bookable_program_id
   AND ce.status = 'ACTIVE'
   AND ce.id <> c.customer_entitlement_id
),
importable_rows AS (
  SELECT c.*
  FROM candidate_rows c
  LEFT JOIN conflicting_active_entitlements conflict
    ON conflict.member_id = c.member_id
   AND conflict.academy_membership_id = c.academy_membership_id
   AND conflict.bookable_program_id = c.bookable_program_id
  WHERE conflict.member_id IS NULL
),
entitlement_upsert AS (
  INSERT INTO public.customer_entitlements (
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
    bookable_program_id,
    source_ref,
    config
  )
  SELECT
    customer_entitlement_id,
    (SELECT tenant_id FROM constants),
    academy_membership_id,
    NULL,
    student_id,
    COALESCE(scope_type, 'STUDENT'),
    student_id,
    entitlement_kind,
    'ACTIVE',
    effective_joined_at,
    NULL,
    source,
    offer_price_id,
    entitlement_template_id,
    bookable_program_id,
    source_ref,
    config ||
      jsonb_build_object(
        'credits_per_period', credits_per_period,
        'credit_period', credit_period,
        'is_unlimited', is_unlimited,
        'credit_cost_policy', credit_cost_policy,
        'source_member_id', member_id::text
      )
  FROM importable_rows
  ON CONFLICT (id) DO UPDATE SET
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
    bookable_program_id = excluded.bookable_program_id,
    source_ref = excluded.source_ref,
    config = excluded.config,
    updated_at = now()
  RETURNING id
),
credit_grant_rows AS (
  SELECT
    md5('parent-credit-ledger-opening-grant:' || customer_entitlement_id::text)::uuid AS credit_ledger_id,
    customer_entitlement_id,
    academy_membership_id,
    student_id,
    member_id,
    credits_per_period,
    credit_period,
    CASE
      WHEN credit_period = 'WEEK' THEN credits_per_period * 4
      ELSE credits_per_period
    END AS opening_credit_delta
  FROM importable_rows
  WHERE entitlement_kind <> 'UNLIMITED_BOOKING'
    AND COALESCE(credits_per_period, 0) > 0
),
credit_grant_insert AS (
  INSERT INTO public.credit_ledger (
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
  SELECT
    credit_ledger_id,
    (SELECT tenant_id FROM constants),
    customer_entitlement_id,
    academy_membership_id,
    student_id,
    NULL,
    'GRANT',
    opening_credit_delta,
    date_trunc('week', now()),
    'import',
    'parent-entitlement-import:opening-grant:' || customer_entitlement_id::text,
    'Opening balance for parent entitlement import.',
    jsonb_build_object(
      'grant_reason', 'opening_balance',
      'credits_per_period', credits_per_period,
      'credit_period', credit_period,
      'source_member_id', member_id::text
    )
  FROM credit_grant_rows
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT
  (SELECT count(*) FROM candidate_rows) AS candidate_entitlements,
  (SELECT count(*) FROM conflicting_active_entitlements) AS skipped_existing_active_entitlements,
  (SELECT count(*) FROM importable_rows) AS importable_entitlements,
  (SELECT count(*) FROM entitlement_upsert) AS upserted_entitlements,
  (SELECT count(*) FROM credit_grant_rows) AS candidate_credit_grants,
  (SELECT count(*) FROM credit_grant_insert) AS inserted_credit_grants;

-- Read-only report for the parent customer entitlement backfill.
--
-- Run against local or linked before applying the operational import:
--   supabase db query --local -f scripts/migration/parent-customer-entitlement-backfill-report.sql
--   supabase db query --linked -f scripts/migration/parent-customer-entitlement-backfill-report.sql

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
summary AS (
  SELECT 'summary' AS section, 'linked_live_members' AS label, count(*)::bigint AS value, NULL::text AS extra
  FROM linked_members

  UNION ALL
  SELECT 'summary', 'stripe_mapped_candidates', count(*), NULL
  FROM stripe_candidates

  UNION ALL
  SELECT 'summary', 'manual_summer_candidates', count(*), NULL
  FROM manual_summer_candidates

  UNION ALL
  SELECT 'summary', 'candidate_entitlements', count(*), NULL
  FROM candidate_rows

  UNION ALL
  SELECT 'summary', 'skipped_existing_active_entitlements', count(*), NULL
  FROM conflicting_active_entitlements

  UNION ALL
  SELECT 'summary', 'importable_entitlements', count(*), NULL
  FROM importable_rows

  UNION ALL
  SELECT 'summary', 'importable_credit_grants', count(*), NULL
  FROM importable_rows
  WHERE entitlement_kind <> 'UNLIMITED_BOOKING'
    AND COALESCE(credits_per_period, 0) > 0
),
distribution AS (
  SELECT
    'offer_price_distribution' AS section,
    offer_price_title AS label,
    count(*)::bigint AS value,
    concat(
      'offer_price_id=', offer_price_id::text,
      ', source=', source,
      ', entitlement_kind=', entitlement_kind
    ) AS extra
  FROM importable_rows
  GROUP BY offer_price_id, offer_price_title, source, entitlement_kind
)
SELECT section, label, value, extra
FROM summary
UNION ALL
SELECT section, label, value, extra
FROM distribution
ORDER BY section, label;

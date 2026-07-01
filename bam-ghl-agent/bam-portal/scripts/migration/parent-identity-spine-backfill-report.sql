-- Read-only report for the parent identity spine backfill.
--
-- Run against the linked project before applying:
--   supabase db query --linked -f scripts/migration/parent-identity-spine-backfill-report.sql

WITH constants AS (
  SELECT '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid AS tenant_id
),
live_members AS (
  SELECT m.*
  FROM public.members m
  JOIN constants c ON c.tenant_id = m.client_id
  WHERE m.status = 'live'
),
routable_members AS (
  SELECT m.*
  FROM live_members m
  WHERE NULLIF(btrim(m.parent_email), '') IS NOT NULL
    AND NULLIF(btrim(m.athlete_name), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.pricing_catalog pc
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
      WHERE pc.client_id = m.client_id
        AND pc.stripe_price_id = m.stripe_price_id
    )
),
candidate_parent_emails AS (
  SELECT DISTINCT lower(btrim(parent_email)) AS email
  FROM routable_members
),
summary AS (
  SELECT
    'summary' AS section,
    'live_members' AS label,
    count(*)::bigint AS value,
    NULL::text AS extra
  FROM live_members

  UNION ALL
  SELECT 'summary', 'missing_parent_email', count(*), NULL
  FROM live_members
  WHERE NULLIF(btrim(parent_email), '') IS NULL

  UNION ALL
  SELECT 'summary', 'missing_athlete_name', count(*), NULL
  FROM live_members
  WHERE NULLIF(btrim(athlete_name), '') IS NULL

  UNION ALL
  SELECT 'summary', 'routable_identity_candidates', count(*), NULL
  FROM routable_members

  UNION ALL
  SELECT 'summary', 'candidate_parent_profiles', count(*), NULL
  FROM candidate_parent_emails

  UNION ALL
  SELECT 'summary', 'candidate_existing_profiles', count(*), NULL
  FROM public.customer_profiles cp
  JOIN candidate_parent_emails cpe
    ON lower(btrim(cp.email::text)) = cpe.email

  UNION ALL
  SELECT 'summary', 'candidate_existing_students', count(*), NULL
  FROM routable_members rm
  JOIN public.students s
    ON s.id = md5('parent-student:' || rm.id::text)::uuid

  UNION ALL
  SELECT 'summary', 'candidate_existing_memberships', count(*), NULL
  FROM routable_members rm
  JOIN public.academy_memberships am
    ON am.id = md5('parent-academy-membership:' || rm.id::text)::uuid

  UNION ALL
  SELECT 'summary', 'candidate_existing_member_links', count(*), NULL
  FROM routable_members rm
  JOIN public.member_links ml
    ON ml.member_id = rm.id
),
offer_distribution AS (
  SELECT
    'offer_price_distribution' AS section,
    op.title AS label,
    count(DISTINCT rm.id)::bigint AS value,
    concat(
      'offer_price_id=',
      op.id::text,
      ', is_active=',
      op.is_active::text,
      ', is_routable=',
      op.is_routable::text
    ) AS extra
  FROM routable_members rm
  JOIN public.pricing_catalog pc
    ON pc.client_id = rm.client_id
   AND pc.stripe_price_id = rm.stripe_price_id
  JOIN public.offer_prices op
    ON op.source_pricing_catalog_id = pc.id
   AND op.tenant_id = pc.client_id
  WHERE EXISTS (
    SELECT 1
    FROM public.entitlement_templates et
    JOIN public.bookable_programs bp
      ON bp.id = et.bookable_program_id
     AND bp.tenant_id = et.tenant_id
     AND bp.status = 'ACTIVE'
    WHERE et.offer_price_id = op.id
      AND et.tenant_id = op.tenant_id
      AND et.status = 'ACTIVE'
  )
  GROUP BY op.id, op.title, op.is_active, op.is_routable
)
SELECT section, label, value, extra
FROM summary
UNION ALL
SELECT section, label, value, extra
FROM offer_distribution
ORDER BY section, label;

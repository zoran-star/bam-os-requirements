-- Operational parent identity spine backfill.
--
-- This is intentionally NOT a numbered Supabase migration. It is production
-- data-dependent and should be run manually after reviewing the read-only
-- report:
--   supabase db query --linked -f scripts/migration/parent-identity-spine-backfill-report.sql
--   supabase db query --linked -f scripts/migration/parent-identity-spine-backfill-apply.sql
--
-- The script contains no hardcoded customer PII. Candidate rows are selected
-- from existing BAM GTA `members` that map to typed offer prices with active
-- entitlement templates.

WITH constants AS (
  SELECT '39875f07-0a4b-4429-a201-2249bc1f24df'::uuid AS tenant_id
),
candidate_members AS (
  SELECT
    m.*,
    lower(btrim(m.parent_email)) AS parent_email_normalized,
    NULLIF(btrim(m.parent_name), '') AS parent_name_normalized,
    NULLIF(btrim(m.athlete_name), '') AS athlete_name_normalized,
    COALESCE(m.stripe_joined_at, m.joined_date::timestamptz, m.created_at, now()) AS effective_joined_at
  FROM public.members m
  JOIN constants c ON c.tenant_id = m.client_id
  WHERE m.status = 'live'
    AND NULLIF(btrim(m.parent_email), '') IS NOT NULL
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
profile_candidates AS (
  SELECT DISTINCT ON (parent_email_normalized)
    md5('parent-customer-profile:' || parent_email_normalized)::uuid AS id,
    parent_email_normalized AS email,
    parent_name_normalized AS parent_name,
    parent_phone,
    effective_joined_at
  FROM candidate_members
  ORDER BY parent_email_normalized, effective_joined_at DESC
),
inserted_profiles AS (
  INSERT INTO public.customer_profiles (
    id,
    supabase_user_id,
    first_name,
    last_name,
    email,
    phone,
    profile_type
  )
  SELECT
    id,
    NULL,
    initcap(COALESCE(NULLIF(split_part(parent_name, ' ', 1), ''), split_part(email, '@', 1))),
    CASE
      WHEN parent_name LIKE '% %' THEN initcap(btrim(substr(parent_name, strpos(parent_name, ' ') + 1)))
      ELSE 'Parent'
    END,
    email,
    parent_phone,
    'PARENT'
  FROM profile_candidates
  ON CONFLICT DO NOTHING
  RETURNING id, lower(btrim(email::text)) AS parent_email_normalized
),
existing_profiles AS (
  SELECT
    cp.id,
    pc.email AS parent_email_normalized
  FROM profile_candidates pc
  JOIN public.customer_profiles cp
    ON lower(btrim(cp.email::text)) = pc.email
),
profile_rows AS (
  SELECT id, parent_email_normalized FROM inserted_profiles
  UNION
  SELECT id, parent_email_normalized FROM existing_profiles
),
student_candidates AS (
  SELECT
    md5('parent-student:' || cm.id::text)::uuid AS id,
    pr.id AS parent_id,
    cm.id AS member_id,
    cm.athlete_name_normalized
  FROM candidate_members cm
  JOIN profile_rows pr
    ON pr.parent_email_normalized = cm.parent_email_normalized
),
student_upsert AS (
  INSERT INTO public.students (
    id,
    parent_id,
    first_name,
    last_name,
    notes
  )
  SELECT
    id,
    parent_id,
    initcap(split_part(athlete_name_normalized, ' ', 1)),
    CASE
      WHEN athlete_name_normalized LIKE '% %' THEN initcap(btrim(substr(athlete_name_normalized, strpos(athlete_name_normalized, ' ') + 1)))
      ELSE 'Member'
    END,
    'Backfilled from BAM GTA member identity spine.'
  FROM student_candidates
  ON CONFLICT (id) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    notes = EXCLUDED.notes
  RETURNING id
),
membership_candidates AS (
  SELECT
    md5('parent-academy-membership:' || cm.id::text)::uuid AS id,
    cm.client_id AS academy_id,
    sc.id AS student_id,
    cm.stripe_customer_id,
    cm.effective_joined_at,
    cm.ghl_contact_id
  FROM candidate_members cm
  JOIN student_candidates sc
    ON sc.member_id = cm.id
  JOIN student_upsert su
    ON su.id = sc.id
),
membership_upsert AS (
  INSERT INTO public.academy_memberships (
    id,
    academy_id,
    student_id,
    stripe_customer_id,
    status,
    joined_at,
    ghl_contact_id
  )
  SELECT
    id,
    academy_id,
    student_id,
    stripe_customer_id,
    'ACTIVE',
    effective_joined_at,
    ghl_contact_id
  FROM membership_candidates
  ON CONFLICT ON CONSTRAINT uq_membership_academy_student DO UPDATE SET
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    status = EXCLUDED.status,
    joined_at = EXCLUDED.joined_at,
    ghl_contact_id = EXCLUDED.ghl_contact_id
  RETURNING id, student_id
),
member_link_candidates AS (
  SELECT
    md5('parent-member-link:' || cm.id::text)::uuid AS id,
    sc.id AS student_id,
    cm.id AS member_id,
    cm.effective_joined_at
  FROM candidate_members cm
  JOIN student_candidates sc
    ON sc.member_id = cm.id
  JOIN student_upsert su
    ON su.id = sc.id
),
member_link_upsert AS (
  INSERT INTO public.member_links (
    id,
    student_id,
    member_id,
    matched_by,
    confirmed_at
  )
  SELECT
    id,
    student_id,
    member_id,
    'email',
    effective_joined_at
  FROM member_link_candidates
  ON CONFLICT ON CONSTRAINT uq_member_links_member DO UPDATE SET
    student_id = EXCLUDED.student_id,
    matched_by = EXCLUDED.matched_by,
    confirmed_at = EXCLUDED.confirmed_at
  RETURNING id, member_id
)
SELECT
  (SELECT count(*) FROM candidate_members) AS candidate_members,
  (SELECT count(DISTINCT parent_email_normalized) FROM candidate_members) AS candidate_profiles,
  (SELECT count(*) FROM profile_rows) AS linked_profiles,
  (SELECT count(*) FROM student_upsert) AS linked_students,
  (SELECT count(*) FROM membership_upsert) AS linked_academy_memberships,
  (SELECT count(*) FROM member_link_upsert) AS linked_member_links;

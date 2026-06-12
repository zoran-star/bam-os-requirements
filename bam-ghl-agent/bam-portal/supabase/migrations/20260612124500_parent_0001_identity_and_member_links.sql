-- Parent-domain migration 0001 — identity trio + member_links (fc-mobile parent app).
-- Spec: fc-mobile/docs/parent-app-migration-0001.md
-- DDL mirrored from fc-core-srvc app/models/customer.py @ commit 1916564
-- (pg_dump --schema-only of the core schema materialized on a scratch Postgres).
-- Core constraint/index names kept verbatim so alembic adoption needs zero renames.
--
-- Deliberate deviations from core (documented in docs/core-handoff/platform-foundations.md):
--   * profile_type / status: TEXT + CHECK with core's uppercase enum values
--     (core uses native enums; alembic converts in place at adoption)
--   * academy_memberships.academy_id -> REFERENCES clients(id) — the vibe tenant
--     table; core's academies is seeded from clients at cutover, FK retargeted then
--   * plan_id: column present, nullable, NO FK — membership_plans lands in 0002
--   * invited_by: column present, nullable, NO FK — core's users table absent here
--   * id columns carry DEFAULT gen_random_uuid() (core generates ids in Python;
--     server default is additive and lets service-role inserts omit the id)
--
-- member_links is interim glue, NOT a core table — the only table in our world
-- that references members. Dropped at cutover, not migrated.
--
-- RLS: every table enabled with ZERO policies (deny-all). All access goes through
-- service-role Vercel fns; this is the only PostgREST barrier. The parent-JWT
-- canary must cover all four tables.
--
-- Idempotent: IF NOT EXISTS guards throughout; applies cleanly twice.

-- ── 1. customer_profiles — the parent ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_user_id character varying(255) NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50),
    profile_type text NOT NULL CHECK (profile_type IN ('PARENT', 'STUDENT')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_customer_profiles_supabase_user_id
    ON public.customer_profiles USING btree (supabase_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_customer_profiles_email
    ON public.customer_profiles USING btree (email);

-- ── 2. students — the child ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    date_of_birth date,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_students_parent_id
    ON public.students USING btree (parent_id);

-- ── 3. academy_memberships — the booking principal ─────────────────────────

CREATE TABLE IF NOT EXISTS public.academy_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    academy_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    customer_id uuid REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
    plan_id uuid,
    stripe_customer_id character varying(255),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    invited_by uuid,
    ghl_contact_id character varying(255),
    CONSTRAINT ck_membership_customer_xor_student CHECK (
        (customer_id IS NOT NULL AND student_id IS NULL) OR
        (customer_id IS NULL AND student_id IS NOT NULL)
    ),
    CONSTRAINT uq_membership_academy_customer UNIQUE (academy_id, customer_id),
    CONSTRAINT uq_membership_academy_student UNIQUE (academy_id, student_id)
);

CREATE INDEX IF NOT EXISTS ix_academy_memberships_customer_id
    ON public.academy_memberships USING btree (customer_id);
CREATE INDEX IF NOT EXISTS ix_academy_memberships_student_id
    ON public.academy_memberships USING btree (student_id);
CREATE INDEX IF NOT EXISTS ix_academy_memberships_plan_id
    ON public.academy_memberships USING btree (plan_id);
CREATE INDEX IF NOT EXISTS ix_academy_memberships_ghl_contact_id
    ON public.academy_memberships USING btree (ghl_contact_id);
CREATE INDEX IF NOT EXISTS ix_membership_academy_customer
    ON public.academy_memberships USING btree (academy_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_membership_academy_student
    ON public.academy_memberships USING btree (academy_id, student_id);

-- ── 4. member_links — interim bridge to PM-owned members (dropped at cutover) ──

CREATE TABLE IF NOT EXISTS public.member_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    matched_by text NOT NULL CHECK (matched_by IN ('email', 'phone', 'manual')),
    confirmed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT uq_member_links_student UNIQUE (student_id),
    CONSTRAINT uq_member_links_member UNIQUE (member_id)
);

-- ── RLS: deny-all on every parent-domain table ──────────────────────────────
-- Zero policies on purpose. Service-role Vercel fns are the only access path.

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_links ENABLE ROW LEVEL SECURITY;

-- Parent-domain migration 0004 - bookable program access spine.
-- Spec: fc-mobile/docs/parent-app-architecture-plan.md
--
-- This adds the thin access target used by booking eligibility:
--   * bookable_programs
--   * entitlement_templates.bookable_program_id
--   * customer_entitlements.bookable_program_id
--   * slot_templates.bookable_program_id
--   * schedule_slots.bookable_program_id
--
-- A bookable program is the thing access is granted to and slots belong to, for
-- example "BAM GTA Training" or a future camp/tournament. Booking eligibility
-- should match entitlements to slots through this ID, not through slot_type,
-- legacy Offer JSON, or marketing copy.
--
-- Phase-one simplification: direct FKs only. No grant bridge tables and no
-- subtype tables until a concrete product case requires them.
--
-- RLS: table enabled with ZERO policies (deny-all). All parent access goes
-- through service-role Vercel fns.
--
-- Idempotent: IF NOT EXISTS guards throughout; applies cleanly twice.

-- -- 1. bookable_programs ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bookable_programs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    source_program_key text NOT NULL,
    title text NOT NULL,
    program_type text NOT NULL CHECK (
        program_type IN ('TRAINING', 'TEAM', 'CAMP_CLINIC', 'LEAGUE', 'TOURNAMENT', 'GYM_RENTAL')
    ),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    description text,
    start_date date,
    end_date date,
    location_id uuid,
    hero_image_url text,
    sort_order integer NOT NULL DEFAULT 0,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_bookable_programs_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT uq_bookable_programs_source_key UNIQUE (tenant_id, source_program_key),
    CONSTRAINT ck_bookable_programs_date_range CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT fk_bookable_programs_location_tenant
        FOREIGN KEY (location_id, tenant_id)
        REFERENCES public.locations(id, client_id)
        ON DELETE SET NULL (location_id)
);

CREATE INDEX IF NOT EXISTS ix_bookable_programs_tenant_status
    ON public.bookable_programs USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_bookable_programs_tenant_type
    ON public.bookable_programs USING btree (tenant_id, program_type);
CREATE INDEX IF NOT EXISTS ix_bookable_programs_tenant_sort
    ON public.bookable_programs USING btree (tenant_id, status, sort_order);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'bookable_programs_updated_at'
          AND tgrelid = 'public.bookable_programs'::regclass
    ) THEN
        CREATE TRIGGER bookable_programs_updated_at
            BEFORE UPDATE ON public.bookable_programs
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

ALTER TABLE public.bookable_programs ENABLE ROW LEVEL SECURITY;

-- -- 2. Access-spine columns -----------------------------------------------

ALTER TABLE public.entitlement_templates
    ADD COLUMN IF NOT EXISTS bookable_program_id uuid;

ALTER TABLE public.customer_entitlements
    ADD COLUMN IF NOT EXISTS bookable_program_id uuid;

ALTER TABLE public.slot_templates
    ADD COLUMN IF NOT EXISTS bookable_program_id uuid;

ALTER TABLE public.schedule_slots
    ADD COLUMN IF NOT EXISTS bookable_program_id uuid;

-- -- 3. Tenant-consistent FKs ----------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_entitlement_templates_program_tenant'
          AND conrelid = 'public.entitlement_templates'::regclass
    ) THEN
        ALTER TABLE public.entitlement_templates
            ADD CONSTRAINT fk_entitlement_templates_program_tenant
            FOREIGN KEY (bookable_program_id, tenant_id)
            REFERENCES public.bookable_programs(id, tenant_id)
            ON DELETE NO ACTION;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_customer_entitlements_program_tenant'
          AND conrelid = 'public.customer_entitlements'::regclass
    ) THEN
        ALTER TABLE public.customer_entitlements
            ADD CONSTRAINT fk_customer_entitlements_program_tenant
            FOREIGN KEY (bookable_program_id, tenant_id)
            REFERENCES public.bookable_programs(id, tenant_id)
            ON DELETE NO ACTION;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_slot_templates_program_tenant'
          AND conrelid = 'public.slot_templates'::regclass
    ) THEN
        ALTER TABLE public.slot_templates
            ADD CONSTRAINT fk_slot_templates_program_tenant
            FOREIGN KEY (bookable_program_id, tenant_id)
            REFERENCES public.bookable_programs(id, tenant_id)
            ON DELETE NO ACTION;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_schedule_slots_program_tenant'
          AND conrelid = 'public.schedule_slots'::regclass
    ) THEN
        ALTER TABLE public.schedule_slots
            ADD CONSTRAINT fk_schedule_slots_program_tenant
            FOREIGN KEY (bookable_program_id, tenant_id)
            REFERENCES public.bookable_programs(id, tenant_id)
            ON DELETE NO ACTION;
    END IF;
END;
$$;

-- -- 4. Production-safe BAM GTA backfill -----------------------------------
-- Local reset applies migrations before seeds, so this is a no-op locally
-- until the seed files insert the BAM GTA client and program rows.

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
    '{"seed":"parent_0004"}'::jsonb
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

UPDATE public.entitlement_templates et
SET bookable_program_id = bp.id
FROM public.offer_prices op
JOIN public.offer_options oo
  ON oo.id = op.offer_option_id
 AND oo.tenant_id = op.tenant_id
JOIN public.bookable_programs bp
  ON bp.tenant_id = op.tenant_id
 AND bp.source_program_key = 'bam-gta-training'
WHERE et.offer_price_id = op.id
  AND et.tenant_id = op.tenant_id
  AND oo.offer_type = 'TRAINING'
  AND et.bookable_program_id IS DISTINCT FROM bp.id;

UPDATE public.customer_entitlements ce
SET bookable_program_id = et.bookable_program_id
FROM public.entitlement_templates et
WHERE ce.source_entitlement_template_id = et.id
  AND ce.tenant_id = et.tenant_id
  AND et.bookable_program_id IS NOT NULL
  AND ce.bookable_program_id IS DISTINCT FROM et.bookable_program_id;

UPDATE public.slot_templates st
SET bookable_program_id = bp.id
FROM public.bookable_programs bp
WHERE bp.tenant_id = st.tenant_id
  AND bp.source_program_key = 'bam-gta-training'
  AND st.slot_type IN ('GROUP_CLASS', 'SHOOTING')
  AND st.bookable_program_id IS DISTINCT FROM bp.id;

UPDATE public.schedule_slots ss
SET bookable_program_id = st.bookable_program_id
FROM public.slot_templates st
WHERE st.id = ss.slot_template_id
  AND st.tenant_id = ss.tenant_id
  AND st.bookable_program_id IS NOT NULL
  AND ss.bookable_program_id IS DISTINCT FROM st.bookable_program_id;

-- -- 5. Enforce authored/load-bearing program IDs --------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.entitlement_templates
        WHERE bookable_program_id IS NULL
    ) THEN
        RAISE EXCEPTION 'entitlement_templates.bookable_program_id backfill incomplete';
    END IF;

    ALTER TABLE public.entitlement_templates
        ALTER COLUMN bookable_program_id SET NOT NULL;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.customer_entitlements
        WHERE bookable_program_id IS NULL
    ) THEN
        RAISE EXCEPTION 'customer_entitlements.bookable_program_id backfill incomplete';
    END IF;

    ALTER TABLE public.customer_entitlements
        ALTER COLUMN bookable_program_id SET NOT NULL;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.slot_templates
        WHERE bookable_program_id IS NULL
    ) THEN
        RAISE EXCEPTION 'slot_templates.bookable_program_id backfill incomplete';
    END IF;

    ALTER TABLE public.slot_templates
        ALTER COLUMN bookable_program_id SET NOT NULL;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schedule_slots
        WHERE bookable_program_id IS NULL
    ) THEN
        RAISE EXCEPTION 'schedule_slots.bookable_program_id backfill incomplete';
    END IF;

    ALTER TABLE public.schedule_slots
        ALTER COLUMN bookable_program_id SET NOT NULL;
END;
$$;

-- -- 6. Lookup indexes ------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_entitlement_templates_program
    ON public.entitlement_templates USING btree (tenant_id, bookable_program_id);

CREATE INDEX IF NOT EXISTS ix_customer_entitlements_program_status
    ON public.customer_entitlements USING btree (tenant_id, bookable_program_id, status);

CREATE INDEX IF NOT EXISTS ix_slot_templates_program
    ON public.slot_templates USING btree (tenant_id, bookable_program_id);

CREATE INDEX IF NOT EXISTS ix_schedule_slots_program_start
    ON public.schedule_slots USING btree (tenant_id, bookable_program_id, start_time);

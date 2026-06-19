-- Parent-domain migration 0002 — schedule read model.
-- Spec: fc-mobile/docs/parent-app-architecture-plan.md
-- DDL mirrored from fc-core-srvc app/models/schedule.py @ commit 1916564,
-- with prototype-side deviations documented below.
--
-- This lands the tables required by the read-only parent schedule APIs:
--   * GET /api/parent/schedule/slots
--   * GET /api/parent/schedule/slots/:slotId
--   * GET /api/parent/reservations/upcoming
--   * GET /api/parent/appointments/past
--
-- Deliberate deviations from core:
--   * tenant_id REFERENCES clients(id) — the vibe tenant table; core's academies
--     table is seeded from clients at cutover, then FKs retarget.
--   * instructor columns are nullable UUIDs with NO FK — core users/staff mapping
--     is not settled in bam-portal yet.
--   * status columns are TEXT + CHECK with core's uppercase enum values.
--   * Offer lineage is soft: nullable ids/keys, no FK to offers/offer_teams while
--     the Business Blueprint schema is still evolving.
--   * id columns carry DEFAULT gen_random_uuid() so service-role inserts can omit id.
--
-- RLS: every table enabled with ZERO policies (deny-all). All parent access goes
-- through service-role Vercel fns; this is the only PostgREST barrier.
--
-- Idempotent: IF NOT EXISTS guards throughout; applies cleanly twice.

-- ── 0. referenced composite keys for tenant-consistent FKs ─────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_academy_memberships_id_academy'
          AND conrelid = 'public.academy_memberships'::regclass
    ) THEN
        ALTER TABLE public.academy_memberships
            ADD CONSTRAINT uq_academy_memberships_id_academy UNIQUE (id, academy_id);
    END IF;
END;
$$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_locations_id_client'
          AND conrelid = 'public.locations'::regclass
    ) THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT uq_locations_id_client UNIQUE (id, client_id);
    END IF;
END;
$$;
-- ── 1. slot_templates — reusable class definitions ─────────────────────────

CREATE TABLE IF NOT EXISTS public.slot_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name character varying(255) NOT NULL,
    slot_type character varying(50) NOT NULL,
    description text,
    default_location character varying(255),
    default_capacity integer NOT NULL DEFAULT 10,
    default_instructor_id uuid,
    recurrence_rule character varying(500),
    recurrence_end_date date,
    default_start_time time without time zone NOT NULL,
    default_end_time time without time zone NOT NULL,
    default_credit_cost integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    location_id uuid,
    source_offer_id uuid,
    source_offer_class_key text,
    offer_team_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_slot_templates_capacity_positive CHECK (default_capacity > 0),
    CONSTRAINT ck_slot_templates_credit_cost_nonnegative CHECK (default_credit_cost >= 0),
    CONSTRAINT ck_slot_templates_time_order CHECK (default_end_time > default_start_time),
    CONSTRAINT uq_slot_templates_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT fk_slot_templates_location_tenant
        FOREIGN KEY (location_id, tenant_id)
        REFERENCES public.locations(id, client_id)
        ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS ix_slot_templates_tenant_active
    ON public.slot_templates USING btree (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS ix_slot_templates_default_instructor_id
    ON public.slot_templates USING btree (default_instructor_id);
CREATE INDEX IF NOT EXISTS ix_slot_templates_location_id
    ON public.slot_templates USING btree (location_id);
CREATE INDEX IF NOT EXISTS ix_slot_templates_source_offer
    ON public.slot_templates USING btree (source_offer_id, source_offer_class_key);
CREATE INDEX IF NOT EXISTS ix_slot_templates_offer_team_id
    ON public.slot_templates USING btree (offer_team_id);
-- ── 2. schedule_slots — materialized bookable sessions ─────────────────────

CREATE TABLE IF NOT EXISTS public.schedule_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name character varying(255) NOT NULL,
    description text,
    slot_type character varying(50) NOT NULL,
    location_label character varying(255),
    capacity integer NOT NULL DEFAULT 10,
    credit_cost integer NOT NULL DEFAULT 1,
    instructor_id uuid,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    slot_template_id uuid NOT NULL,
    is_cancelled boolean NOT NULL DEFAULT false,
    location_id uuid,
    source_offer_id uuid,
    source_offer_class_key text,
    offer_team_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_schedule_slots_capacity_positive CHECK (capacity > 0),
    CONSTRAINT ck_schedule_slots_credit_cost_nonnegative CHECK (credit_cost >= 0),
    CONSTRAINT ck_schedule_slots_time_order CHECK (end_time > start_time),
    CONSTRAINT uq_schedule_slots_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT fk_schedule_slots_template_tenant
        FOREIGN KEY (slot_template_id, tenant_id)
        REFERENCES public.slot_templates(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_schedule_slots_location_tenant
        FOREIGN KEY (location_id, tenant_id)
        REFERENCES public.locations(id, client_id)
        ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_tenant_start
    ON public.schedule_slots USING btree (tenant_id, start_time);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_tenant_type
    ON public.schedule_slots USING btree (tenant_id, slot_type);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_availability
    ON public.schedule_slots USING btree (tenant_id, instructor_id, start_time, end_time)
    WHERE is_cancelled = false AND instructor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_schedule_slots_instructor_id
    ON public.schedule_slots USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_slot_template_id
    ON public.schedule_slots USING btree (slot_template_id);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_location_id
    ON public.schedule_slots USING btree (location_id);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_source_offer
    ON public.schedule_slots USING btree (source_offer_id, source_offer_class_key);
CREATE INDEX IF NOT EXISTS ix_schedule_slots_offer_team_id
    ON public.schedule_slots USING btree (offer_team_id);
-- ── 3. reservations — confirmed/cancelled booked sessions ──────────────────

CREATE TABLE IF NOT EXISTS public.reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'CANCELLED', 'ATTENDED', 'NO_SHOW', 'LATE_CANCEL')),
    booked_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    ghl_appointment_id character varying(255),
    location_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reservation_slot_membership UNIQUE (slot_id, membership_id),
    CONSTRAINT fk_reservations_slot_tenant
        FOREIGN KEY (slot_id, tenant_id)
        REFERENCES public.schedule_slots(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reservations_membership_tenant
        FOREIGN KEY (membership_id, tenant_id)
        REFERENCES public.academy_memberships(id, academy_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reservations_location_tenant
        FOREIGN KEY (location_id, tenant_id)
        REFERENCES public.locations(id, client_id)
        ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS ix_reservations_slot_id
    ON public.reservations USING btree (slot_id);
CREATE INDEX IF NOT EXISTS ix_reservations_membership_id
    ON public.reservations USING btree (membership_id);
CREATE INDEX IF NOT EXISTS ix_reservations_student_id
    ON public.reservations USING btree (student_id);
CREATE INDEX IF NOT EXISTS ix_reservations_ghl_appointment_id
    ON public.reservations USING btree (ghl_appointment_id);
CREATE INDEX IF NOT EXISTS ix_reservations_location_id
    ON public.reservations USING btree (location_id);
CREATE INDEX IF NOT EXISTS ix_reservations_tenant_status
    ON public.reservations USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_reservations_membership_status
    ON public.reservations USING btree (membership_id, status);
-- ── 4. waitlist_entries — FIFO waitlist rows per slot ──────────────────────

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'PROMOTED', 'EXPIRED', 'REMOVED')),
    promoted_at timestamptz,
    location_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_waitlist_slot_membership UNIQUE (slot_id, membership_id),
    CONSTRAINT fk_waitlist_entries_slot_tenant
        FOREIGN KEY (slot_id, tenant_id)
        REFERENCES public.schedule_slots(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_waitlist_entries_membership_tenant
        FOREIGN KEY (membership_id, tenant_id)
        REFERENCES public.academy_memberships(id, academy_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_waitlist_entries_location_tenant
        FOREIGN KEY (location_id, tenant_id)
        REFERENCES public.locations(id, client_id)
        ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS ix_waitlist_entries_slot_id
    ON public.waitlist_entries USING btree (slot_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_entries_membership_id
    ON public.waitlist_entries USING btree (membership_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_entries_student_id
    ON public.waitlist_entries USING btree (student_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_entries_location_id
    ON public.waitlist_entries USING btree (location_id);
CREATE INDEX IF NOT EXISTS ix_waitlist_slot_status
    ON public.waitlist_entries USING btree (slot_id, status);
CREATE INDEX IF NOT EXISTS ix_waitlist_slot_created
    ON public.waitlist_entries USING btree (slot_id, created_at);
-- ── updated_at triggers ────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'slot_templates_updated_at'
          AND tgrelid = 'public.slot_templates'::regclass
    ) THEN
        CREATE TRIGGER slot_templates_updated_at
            BEFORE UPDATE ON public.slot_templates
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'schedule_slots_updated_at'
          AND tgrelid = 'public.schedule_slots'::regclass
    ) THEN
        CREATE TRIGGER schedule_slots_updated_at
            BEFORE UPDATE ON public.schedule_slots
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'reservations_updated_at'
          AND tgrelid = 'public.reservations'::regclass
    ) THEN
        CREATE TRIGGER reservations_updated_at
            BEFORE UPDATE ON public.reservations
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'waitlist_entries_updated_at'
          AND tgrelid = 'public.waitlist_entries'::regclass
    ) THEN
        CREATE TRIGGER waitlist_entries_updated_at
            BEFORE UPDATE ON public.waitlist_entries
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;
-- ── RLS: deny-all on every parent-domain schedule table ────────────────────
-- Zero policies on purpose. Service-role Vercel fns are the only access path.

ALTER TABLE public.slot_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Parent-app free trial identity linkage.
--
-- Trial eligibility remains derived from durable history:
--   * no ACTIVE student membership for this academy, and
--   * no non-cancelled app-linked trial for this student at this academy.
--
-- Public website trials continue to work from email/name only. Logged-in
-- parent-app trials pass customer_profile_id + student_id and get stronger
-- one-trial-per-child guards.

ALTER TABLE public.trial_bookings
    ADD COLUMN IF NOT EXISTS customer_profile_id uuid REFERENCES public.customer_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trial_bookings.customer_profile_id IS
    'Parent profile for logged-in parent-app trial bookings. Null for public website/staff/import trials.';

COMMENT ON COLUMN public.trial_bookings.student_id IS
    'Child profile for logged-in parent-app trial bookings. Null for public website/staff/import trials.';

ALTER TABLE public.trial_bookings
    DROP CONSTRAINT IF EXISTS ck_trial_bookings_source;

ALTER TABLE public.trial_bookings
    ADD CONSTRAINT ck_trial_bookings_source CHECK (
        source IN ('website', 'parent_app', 'staff', 'import', 'admin')
    );

CREATE INDEX IF NOT EXISTS ix_trial_bookings_tenant_student_status
    ON public.trial_bookings USING btree (tenant_id, student_id, status)
    WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_trial_bookings_tenant_profile_status
    ON public.trial_bookings USING btree (tenant_id, customer_profile_id, status)
    WHERE customer_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_trial_bookings_tenant_email_status
    ON public.trial_bookings USING btree (tenant_id, lower(parent_email), status);

DROP INDEX IF EXISTS public.uq_trial_bookings_slot_email_booked;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_bookings_slot_email_booked
    ON public.trial_bookings USING btree (slot_id, lower(parent_email))
    WHERE status = 'BOOKED'
      AND source <> 'parent_app';

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_bookings_one_app_trial_per_student
    ON public.trial_bookings USING btree (tenant_id, student_id)
    WHERE student_id IS NOT NULL
      AND status IN ('BOOKED', 'SHOWED', 'NO_SHOW', 'CONVERTED');

-- Replace the old signature instead of creating an overload. PostgREST RPC
-- resolution is much more predictable when there is only one book_trial_slot.
DROP FUNCTION IF EXISTS public.book_trial_slot(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    date,
    uuid,
    uuid,
    text,
    text,
    jsonb
);

CREATE OR REPLACE FUNCTION public.book_trial_slot(
    p_tenant_id uuid,
    p_slot_id uuid,
    p_parent_name text,
    p_parent_email text,
    p_athlete_name text,
    p_parent_phone text DEFAULT NULL,
    p_athlete_dob date DEFAULT NULL,
    p_entry_point_id uuid DEFAULT NULL,
    p_offer_id uuid DEFAULT NULL,
    p_ghl_contact_id text DEFAULT NULL,
    p_source text DEFAULT 'website',
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_customer_profile_id uuid DEFAULT NULL,
    p_student_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    existing_trial public.trial_bookings%ROWTYPE;
    profile_row public.customer_profiles%ROWTYPE;
    student_row public.students%ROWTYPE;
    normalized_parent_name text;
    normalized_parent_email text;
    normalized_parent_phone text;
    normalized_athlete_name text;
    normalized_ghl_contact_id text;
    normalized_source text;
    normalized_metadata jsonb;
    booked_count integer;
    trial_booking_id uuid;
BEGIN
    normalized_parent_name := NULLIF(btrim(p_parent_name), '');
    normalized_parent_email := lower(NULLIF(btrim(p_parent_email), ''));
    normalized_parent_phone := NULLIF(btrim(p_parent_phone), '');
    normalized_athlete_name := NULLIF(btrim(p_athlete_name), '');
    normalized_ghl_contact_id := NULLIF(btrim(p_ghl_contact_id), '');
    normalized_source := lower(COALESCE(NULLIF(btrim(p_source), ''), 'website'));
    normalized_metadata := COALESCE(p_metadata, '{}'::jsonb);

    IF normalized_parent_name IS NULL THEN
        RAISE EXCEPTION 'Parent name is required.';
    END IF;

    IF normalized_parent_email IS NULL THEN
        RAISE EXCEPTION 'Parent email is required.';
    END IF;

    IF normalized_athlete_name IS NULL THEN
        RAISE EXCEPTION 'Athlete name is required.';
    END IF;

    IF normalized_source NOT IN ('website', 'parent_app', 'staff', 'import', 'admin') THEN
        RAISE EXCEPTION 'Invalid trial booking source.';
    END IF;

    IF normalized_source = 'parent_app'
       AND (p_customer_profile_id IS NULL OR p_student_id IS NULL)
    THEN
        RAISE EXCEPTION 'Parent-app trial bookings require customer profile and student ids.';
    END IF;

    IF p_customer_profile_id IS NOT NULL THEN
        SELECT *
        INTO profile_row
        FROM public.customer_profiles
        WHERE id = p_customer_profile_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer profile not found.';
        END IF;

        IF lower(btrim(profile_row.email::text)) IS DISTINCT FROM normalized_parent_email THEN
            RAISE EXCEPTION 'Parent email does not match customer profile.';
        END IF;
    END IF;

    IF p_student_id IS NOT NULL THEN
        IF p_customer_profile_id IS NULL THEN
            RAISE EXCEPTION 'Customer profile is required when student id is provided.';
        END IF;

        SELECT *
        INTO student_row
        FROM public.students
        WHERE id = p_student_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Student not found.';
        END IF;

        IF student_row.parent_id IS DISTINCT FROM p_customer_profile_id THEN
            RAISE EXCEPTION 'Student does not belong to this parent.';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.academy_memberships am
            WHERE am.academy_id = p_tenant_id
              AND am.student_id = p_student_id
              AND am.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'Student already has an active membership.';
        END IF;

        SELECT *
        INTO existing_trial
        FROM public.trial_bookings
        WHERE tenant_id = p_tenant_id
          AND student_id = p_student_id
          AND status = 'BOOKED'
        ORDER BY booked_at DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            IF existing_trial.slot_id = p_slot_id THEN
                RETURN existing_trial.id;
            END IF;

            RAISE EXCEPTION 'Student already has a booked trial.';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.trial_bookings tb
            WHERE tb.tenant_id = p_tenant_id
              AND tb.student_id = p_student_id
              AND tb.status IN ('SHOWED', 'NO_SHOW', 'CONVERTED')
        ) THEN
            RAISE EXCEPTION 'Student has already used a free trial.';
        END IF;
    END IF;

    SELECT *
    INTO slot_row
    FROM public.schedule_slots
    WHERE id = p_slot_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Slot not found.';
    END IF;

    IF slot_row.is_cancelled THEN
        RAISE EXCEPTION 'Slot is cancelled.';
    END IF;

    IF slot_row.start_time <= now() THEN
        RAISE EXCEPTION 'Slot has already started.';
    END IF;

    IF slot_row.capacity IS NULL OR slot_row.capacity <= 0 THEN
        RAISE EXCEPTION 'Slot capacity is not configured.';
    END IF;

    IF normalized_source <> 'parent_app' THEN
        SELECT *
        INTO existing_trial
        FROM public.trial_bookings
        WHERE tenant_id = p_tenant_id
          AND slot_id = p_slot_id
          AND lower(parent_email) = normalized_parent_email
          AND status = 'BOOKED'
        FOR UPDATE;

        IF FOUND THEN
            RETURN existing_trial.id;
        END IF;
    END IF;

    SELECT public.slot_spots_taken(p_tenant_id, p_slot_id)
    INTO booked_count;

    IF booked_count >= slot_row.capacity THEN
        RAISE EXCEPTION 'Slot is full.';
    END IF;

    INSERT INTO public.trial_bookings (
        tenant_id,
        slot_id,
        bookable_program_id,
        entry_point_id,
        offer_id,
        ghl_contact_id,
        customer_profile_id,
        student_id,
        parent_name,
        parent_email,
        parent_phone,
        athlete_name,
        athlete_dob,
        status,
        source,
        metadata
    )
    VALUES (
        p_tenant_id,
        p_slot_id,
        slot_row.bookable_program_id,
        p_entry_point_id,
        p_offer_id,
        normalized_ghl_contact_id,
        p_customer_profile_id,
        p_student_id,
        normalized_parent_name,
        normalized_parent_email,
        normalized_parent_phone,
        normalized_athlete_name,
        p_athlete_dob,
        'BOOKED',
        normalized_source,
        normalized_metadata
    )
    RETURNING id INTO trial_booking_id;

    RETURN trial_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.book_trial_slot(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    date,
    uuid,
    uuid,
    text,
    text,
    jsonb,
    uuid,
    uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.book_trial_slot(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    date,
    uuid,
    uuid,
    text,
    text,
    jsonb,
    uuid,
    uuid
) TO service_role;

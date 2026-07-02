-- Parent trial bookings and shared capacity extension.
--
-- Free-trial leads book into the same schedule_slots as paid members, but live
-- in a separate table because they do not have memberships, entitlements, or
-- credit ledger rows yet.

-- -- 1. trial_bookings -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.trial_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL,
    bookable_program_id uuid REFERENCES public.bookable_programs(id),
    entry_point_id uuid,
    offer_id uuid,
    ghl_contact_id text,
    parent_name text NOT NULL,
    parent_email text NOT NULL,
    parent_phone text,
    athlete_name text NOT NULL,
    athlete_dob date,
    status text NOT NULL DEFAULT 'BOOKED',
    source text NOT NULL DEFAULT 'website',
    converted_member_id uuid,
    converted_membership_id uuid REFERENCES public.academy_memberships(id),
    converted_at timestamptz,
    booked_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_trial_bookings_status CHECK (
        status IN ('BOOKED', 'CANCELLED', 'SHOWED', 'NO_SHOW', 'CONVERTED')
    ),
    CONSTRAINT ck_trial_bookings_source CHECK (
        source IN ('website', 'staff', 'import', 'admin')
    ),
    CONSTRAINT fk_trial_bookings_slot_tenant
        FOREIGN KEY (slot_id, tenant_id)
        REFERENCES public.schedule_slots(id, tenant_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_trial_bookings_tenant_slot_status
    ON public.trial_bookings USING btree (tenant_id, slot_id, status);

CREATE INDEX IF NOT EXISTS ix_trial_bookings_booked_slot
    ON public.trial_bookings USING btree (slot_id)
    WHERE status = 'BOOKED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_bookings_slot_email_booked
    ON public.trial_bookings USING btree (slot_id, lower(parent_email))
    WHERE status = 'BOOKED';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trial_bookings_updated_at'
          AND tgrelid = 'public.trial_bookings'::regclass
    ) THEN
        CREATE TRIGGER trial_bookings_updated_at
            BEFORE UPDATE ON public.trial_bookings
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

ALTER TABLE public.trial_bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trial_bookings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.trial_bookings TO service_role;

-- -- 2. shared slot capacity ----------------------------------------------

-- slot_spots_taken is the single source of truth for shared slot capacity:
-- confirmed member reservations plus active trial bookings.
CREATE OR REPLACE FUNCTION public.slot_spots_taken(
    p_tenant_id uuid,
    p_slot_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT (
        (
            SELECT COUNT(*)
            FROM public.reservations r
            WHERE r.tenant_id = p_tenant_id
              AND r.slot_id = p_slot_id
              AND r.status = 'CONFIRMED'
        ) + (
            SELECT COUNT(*)
            FROM public.trial_bookings tb
            WHERE tb.tenant_id = p_tenant_id
              AND tb.slot_id = p_slot_id
              AND tb.status = 'BOOKED'
        )
    )::integer;
$$;

-- -- 3. trial booking RPCs -------------------------------------------------

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
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    existing_trial public.trial_bookings%ROWTYPE;
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

    IF normalized_source NOT IN ('website', 'staff', 'import', 'admin') THEN
        RAISE EXCEPTION 'Invalid trial booking source.';
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

CREATE OR REPLACE FUNCTION public.cancel_trial_booking(
    p_tenant_id uuid,
    p_trial_booking_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    trial_row public.trial_bookings%ROWTYPE;
BEGIN
    SELECT s.*
    INTO slot_row
    FROM public.trial_bookings tb
    JOIN public.schedule_slots s
      ON s.id = tb.slot_id
     AND s.tenant_id = tb.tenant_id
    WHERE tb.id = p_trial_booking_id
      AND tb.tenant_id = p_tenant_id
    FOR UPDATE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    SELECT *
    INTO trial_row
    FROM public.trial_bookings
    WHERE id = p_trial_booking_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    IF trial_row.status <> 'BOOKED' THEN
        RETURN false;
    END IF;

    UPDATE public.trial_bookings
    SET status = 'CANCELLED',
        cancelled_at = now(),
        updated_at = now()
    WHERE id = trial_row.id;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_trial_booking(
    p_tenant_id uuid,
    p_trial_booking_id uuid,
    p_new_slot_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    trial_probe public.trial_bookings%ROWTYPE;
    trial_row public.trial_bookings%ROWTYPE;
    locked_slot public.schedule_slots%ROWTYPE;
    current_slot_row public.schedule_slots%ROWTYPE;
    new_slot_row public.schedule_slots%ROWTYPE;
    current_slot_found boolean := false;
    new_slot_found boolean := false;
    booked_count integer;
BEGIN
    SELECT *
    INTO trial_probe
    FROM public.trial_bookings
    WHERE id = p_trial_booking_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    IF trial_probe.slot_id = p_new_slot_id THEN
        RETURN trial_probe.id;
    END IF;

    -- Lock current and new slot rows in uuid order to avoid reschedule deadlocks.
    FOR locked_slot IN
        SELECT *
        FROM public.schedule_slots
        WHERE tenant_id = p_tenant_id
          AND id IN (trial_probe.slot_id, p_new_slot_id)
        ORDER BY id ASC
        FOR UPDATE
    LOOP
        IF locked_slot.id = trial_probe.slot_id THEN
            current_slot_row := locked_slot;
            current_slot_found := true;
        END IF;

        IF locked_slot.id = p_new_slot_id THEN
            new_slot_row := locked_slot;
            new_slot_found := true;
        END IF;
    END LOOP;

    IF NOT current_slot_found THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    IF NOT new_slot_found THEN
        RAISE EXCEPTION 'Slot not found.';
    END IF;

    SELECT *
    INTO trial_row
    FROM public.trial_bookings
    WHERE id = p_trial_booking_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    IF trial_row.slot_id = p_new_slot_id THEN
        RETURN trial_row.id;
    END IF;

    IF trial_row.slot_id IS DISTINCT FROM current_slot_row.id THEN
        RAISE EXCEPTION 'Trial booking changed during reschedule.';
    END IF;

    IF trial_row.status <> 'BOOKED' THEN
        RAISE EXCEPTION 'Trial booking cannot be rescheduled from its current status.';
    END IF;

    IF new_slot_row.is_cancelled THEN
        RAISE EXCEPTION 'Slot is cancelled.';
    END IF;

    IF new_slot_row.start_time <= now() THEN
        RAISE EXCEPTION 'Slot has already started.';
    END IF;

    IF new_slot_row.capacity IS NULL OR new_slot_row.capacity <= 0 THEN
        RAISE EXCEPTION 'Slot capacity is not configured.';
    END IF;

    SELECT public.slot_spots_taken(p_tenant_id, p_new_slot_id)
    INTO booked_count;

    IF booked_count >= new_slot_row.capacity THEN
        RAISE EXCEPTION 'Slot is full.';
    END IF;

    UPDATE public.trial_bookings
    SET slot_id = p_new_slot_id,
        bookable_program_id = new_slot_row.bookable_program_id,
        updated_at = now()
    WHERE id = trial_row.id;

    RETURN trial_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_trial_outcome(
    p_tenant_id uuid,
    p_trial_booking_id uuid,
    p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    trial_row public.trial_bookings%ROWTYPE;
    normalized_status text;
BEGIN
    normalized_status := upper(NULLIF(btrim(p_status), ''));

    IF normalized_status IS NULL OR normalized_status NOT IN ('SHOWED', 'NO_SHOW') THEN
        RAISE EXCEPTION 'Trial outcome must be SHOWED or NO_SHOW.';
    END IF;

    SELECT *
    INTO trial_row
    FROM public.trial_bookings
    WHERE id = p_trial_booking_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trial booking not found.';
    END IF;

    IF trial_row.status IN ('CANCELLED', 'CONVERTED') THEN
        RAISE EXCEPTION 'Trial booking outcome cannot be set from its current status.';
    END IF;

    IF trial_row.status = normalized_status THEN
        RETURN false;
    END IF;

    UPDATE public.trial_bookings
    SET status = normalized_status,
        updated_at = now()
    WHERE id = trial_row.id;

    RETURN true;
END;
$$;

-- -- 4. staff slot cancellation extension ---------------------------------

-- The return shape changes, so drop the old signature before recreating it.
DROP FUNCTION IF EXISTS public.staff_cancel_slot(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.staff_cancel_slot(
    p_tenant_id uuid,
    p_slot_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS TABLE (
    reservations_cancelled integer,
    credits_refunded integer,
    waitlist_cancelled integer,
    trials_cancelled integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    cancelled_reservation_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    reservations_cancelled := 0;
    credits_refunded := 0;
    waitlist_cancelled := 0;
    trials_cancelled := 0;

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
        RETURN NEXT;
        RETURN;
    END IF;

    -- schedule_slots has no metadata/notes column in parent_0002; p_reason is
    -- retained for API compatibility and is intentionally not persisted here.
    UPDATE public.schedule_slots
    SET is_cancelled = true,
        updated_at = now()
    WHERE id = slot_row.id;

    WITH cancelled AS (
        UPDATE public.reservations
        SET status = 'CANCELLED',
            cancelled_at = now(),
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND slot_id = p_slot_id
          AND status = 'CONFIRMED'
        RETURNING id
    )
    SELECT
        COALESCE(array_agg(id), ARRAY[]::uuid[]),
        COUNT(*)::integer
    INTO cancelled_reservation_ids, reservations_cancelled
    FROM cancelled;

    WITH refundable AS (
        SELECT
            cl.customer_entitlement_id,
            cl.academy_membership_id,
            cl.student_id,
            cl.reservation_id,
            COALESCE(SUM(cl.credit_delta), 0)::integer AS net_credit_delta
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = p_tenant_id
          AND cl.reservation_id = ANY(cancelled_reservation_ids)
        GROUP BY
            cl.customer_entitlement_id,
            cl.academy_membership_id,
            cl.student_id,
            cl.reservation_id
        HAVING COALESCE(SUM(cl.credit_delta), 0)::integer < 0
    ),
    inserted_refunds AS (
        INSERT INTO public.credit_ledger (
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
            p_tenant_id,
            refundable.customer_entitlement_id,
            refundable.academy_membership_id,
            refundable.student_id,
            refundable.reservation_id,
            'REFUND',
            -refundable.net_credit_delta,
            now(),
            'cancel',
            'reservation:' || refundable.reservation_id::text,
            'Staff slot cancellation refund.',
            jsonb_build_object('slot_id', p_slot_id, 'cancel_reason', p_reason)
        FROM refundable
        RETURNING credit_delta
    )
    SELECT COALESCE(SUM(credit_delta), 0)::integer
    INTO credits_refunded
    FROM inserted_refunds;

    WITH removed_waitlist AS (
        UPDATE public.waitlist_entries
        SET status = 'REMOVED',
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND slot_id = p_slot_id
          AND status = 'WAITING'
        RETURNING id
    )
    SELECT COUNT(*)::integer
    INTO waitlist_cancelled
    FROM removed_waitlist;

    WITH cancelled_trials AS (
        UPDATE public.trial_bookings
        SET status = 'CANCELLED',
            cancelled_at = now(),
            updated_at = now()
        WHERE tenant_id = p_tenant_id
          AND slot_id = p_slot_id
          AND status = 'BOOKED'
        RETURNING id
    )
    SELECT COUNT(*)::integer
    INTO trials_cancelled
    FROM cancelled_trials;

    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.slot_spots_taken(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_trial_slot(uuid, uuid, text, text, text, text, date, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_trial_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_trial_booking(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_trial_outcome(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_cancel_slot(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.slot_spots_taken(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_trial_slot(uuid, uuid, text, text, text, text, date, uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_trial_booking(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_trial_booking(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_trial_outcome(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_cancel_slot(uuid, uuid, text) TO service_role;

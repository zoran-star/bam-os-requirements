-- Parent shared slot capacity.
--
-- This centralizes slot capacity consumption so booking and waitlist logic stay
-- aligned as new booking sources are wired in.

-- slot_spots_taken is the single source of truth for slot capacity consumption
-- per the parent runtime wiring plan; when trial_bookings exists, active trial
-- bookings must be added HERE and nowhere else.
CREATE OR REPLACE FUNCTION public.slot_spots_taken(
    p_tenant_id uuid,
    p_slot_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT COUNT(*)::integer
    FROM public.reservations r
    WHERE r.tenant_id = p_tenant_id
      AND r.slot_id = p_slot_id
      AND r.status = 'CONFIRMED';
$$;

CREATE OR REPLACE FUNCTION public.parent_book_slot(
    p_tenant_id uuid,
    p_slot_id uuid,
    p_membership_id uuid,
    p_student_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    membership_row public.academy_memberships%ROWTYPE;
    existing_reservation public.reservations%ROWTYPE;
    selected_entitlement record;
    normalized_student_id uuid;
    booked_count integer;
    credit_cost integer;
    reservation_id uuid;
BEGIN
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
    INTO membership_row
    FROM public.academy_memberships
    WHERE id = p_membership_id
      AND academy_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found.';
    END IF;

    IF membership_row.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Membership is not active.';
    END IF;

    normalized_student_id := COALESCE(p_student_id, membership_row.student_id);

    IF membership_row.student_id IS NOT NULL
       AND normalized_student_id IS DISTINCT FROM membership_row.student_id
    THEN
        RAISE EXCEPTION 'Student does not belong to membership.';
    END IF;

    IF membership_row.customer_id IS NOT NULL
       AND normalized_student_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.students s
           WHERE s.id = normalized_student_id
             AND s.parent_id = membership_row.customer_id
       )
    THEN
        RAISE EXCEPTION 'Student does not belong to this parent.';
    END IF;

    SELECT *
    INTO existing_reservation
    FROM public.reservations
    WHERE slot_id = p_slot_id
      AND membership_id = p_membership_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF FOUND AND existing_reservation.status = 'CONFIRMED' THEN
        RETURN existing_reservation.id;
    END IF;

    credit_cost := COALESCE(slot_row.credit_cost, 1);

    SELECT *
    INTO selected_entitlement
    FROM public.parent_select_booking_entitlement(
        p_tenant_id,
        p_membership_id,
        normalized_student_id,
        slot_row.bookable_program_id,
        credit_cost
    );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active entitlement with enough credits for this slot.';
    END IF;

    SELECT public.slot_spots_taken(p_tenant_id, p_slot_id)
    INTO booked_count;

    IF booked_count >= slot_row.capacity THEN
        RAISE EXCEPTION 'Slot is full.';
    END IF;

    IF existing_reservation.id IS NOT NULL THEN
        UPDATE public.reservations
        SET status = 'CONFIRMED',
            student_id = normalized_student_id,
            booked_at = now(),
            cancelled_at = null,
            location_id = slot_row.location_id,
            updated_at = now()
        WHERE id = existing_reservation.id
        RETURNING id INTO reservation_id;
    ELSE
        INSERT INTO public.reservations (
            tenant_id,
            slot_id,
            membership_id,
            student_id,
            status,
            booked_at,
            cancelled_at,
            location_id
        )
        VALUES (
            p_tenant_id,
            p_slot_id,
            p_membership_id,
            normalized_student_id,
            'CONFIRMED',
            now(),
            null,
            slot_row.location_id
        )
        RETURNING id INTO reservation_id;
    END IF;

    IF credit_cost > 0 AND NOT selected_entitlement.entitlement_is_unlimited THEN
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
        VALUES (
            p_tenant_id,
            selected_entitlement.customer_entitlement_id,
            p_membership_id,
            normalized_student_id,
            reservation_id,
            'DEBIT',
            -credit_cost,
            now(),
            'booking',
            'reservation:' || reservation_id::text,
            'Parent app booking debit.',
            jsonb_build_object('slot_id', p_slot_id, 'credit_cost', credit_cost)
        );
    END IF;

    UPDATE public.waitlist_entries
    SET status = 'PROMOTED',
        promoted_at = now(),
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND slot_id = p_slot_id
      AND membership_id = p_membership_id
      AND status = 'WAITING';

    RETURN reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_join_waitlist(
    p_tenant_id uuid,
    p_slot_id uuid,
    p_membership_id uuid,
    p_student_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    slot_row public.schedule_slots%ROWTYPE;
    membership_row public.academy_memberships%ROWTYPE;
    existing_waitlist public.waitlist_entries%ROWTYPE;
    selected_entitlement record;
    normalized_student_id uuid;
    booked_count integer;
    waitlist_id uuid;
BEGIN
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
    INTO membership_row
    FROM public.academy_memberships
    WHERE id = p_membership_id
      AND academy_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership not found.';
    END IF;

    IF membership_row.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Membership is not active.';
    END IF;

    normalized_student_id := COALESCE(p_student_id, membership_row.student_id);

    IF membership_row.student_id IS NOT NULL
       AND normalized_student_id IS DISTINCT FROM membership_row.student_id
    THEN
        RAISE EXCEPTION 'Student does not belong to membership.';
    END IF;

    IF membership_row.customer_id IS NOT NULL
       AND normalized_student_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.students s
           WHERE s.id = normalized_student_id
             AND s.parent_id = membership_row.customer_id
       )
    THEN
        RAISE EXCEPTION 'Student does not belong to this parent.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.reservations r
        WHERE r.tenant_id = p_tenant_id
          AND r.slot_id = p_slot_id
          AND r.membership_id = p_membership_id
          AND r.status = 'CONFIRMED'
    ) THEN
        RAISE EXCEPTION 'Slot is already booked.';
    END IF;

    SELECT *
    INTO selected_entitlement
    FROM public.parent_select_booking_entitlement(
        p_tenant_id,
        p_membership_id,
        normalized_student_id,
        slot_row.bookable_program_id,
        COALESCE(slot_row.credit_cost, 1)
    );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active entitlement with enough credits for this slot.';
    END IF;

    SELECT public.slot_spots_taken(p_tenant_id, p_slot_id)
    INTO booked_count;

    IF booked_count < slot_row.capacity THEN
        RAISE EXCEPTION 'Slot has open spots. Book instead.';
    END IF;

    SELECT *
    INTO existing_waitlist
    FROM public.waitlist_entries
    WHERE slot_id = p_slot_id
      AND membership_id = p_membership_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF FOUND AND existing_waitlist.status = 'WAITING' THEN
        RETURN existing_waitlist.id;
    END IF;

    IF existing_waitlist.id IS NOT NULL THEN
        UPDATE public.waitlist_entries
        SET status = 'WAITING',
            student_id = normalized_student_id,
            promoted_at = null,
            location_id = slot_row.location_id,
            created_at = now(),
            updated_at = now()
        WHERE id = existing_waitlist.id
        RETURNING id INTO waitlist_id;
    ELSE
        INSERT INTO public.waitlist_entries (
            tenant_id,
            slot_id,
            membership_id,
            student_id,
            status,
            promoted_at,
            location_id,
            created_at
        )
        VALUES (
            p_tenant_id,
            p_slot_id,
            p_membership_id,
            normalized_student_id,
            'WAITING',
            null,
            slot_row.location_id,
            now()
        )
        RETURNING id INTO waitlist_id;
    END IF;

    RETURN waitlist_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_cancel_reservation(
    p_tenant_id uuid,
    p_reservation_id uuid,
    p_membership_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    reservation_row public.reservations%ROWTYPE;
    slot_row public.schedule_slots%ROWTYPE;
    ledger_group record;
    waitlist_row public.waitlist_entries%ROWTYPE;
    waitlist_membership_row public.academy_memberships%ROWTYPE;
    existing_promotion_reservation public.reservations%ROWTYPE;
    promotion_entitlement record;
    promotion_student_id uuid;
    promotion_reservation_id uuid;
    booked_count integer;
    credit_cost integer;
BEGIN
    SELECT s.*
    INTO slot_row
    FROM public.reservations r
    JOIN public.schedule_slots s
      ON s.id = r.slot_id
     AND s.tenant_id = r.tenant_id
    WHERE r.id = p_reservation_id
      AND r.tenant_id = p_tenant_id
      AND r.membership_id = p_membership_id
    FOR UPDATE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found.';
    END IF;

    SELECT *
    INTO reservation_row
    FROM public.reservations
    WHERE id = p_reservation_id
      AND tenant_id = p_tenant_id
      AND membership_id = p_membership_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found.';
    END IF;

    IF reservation_row.status = 'CANCELLED' THEN
        RETURN reservation_row.id;
    END IF;

    IF reservation_row.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Reservation cannot be cancelled from its current status.';
    END IF;

    IF slot_row.start_time <= now() THEN
        RAISE EXCEPTION 'Reservation can no longer be cancelled.';
    END IF;

    UPDATE public.reservations
    SET status = 'CANCELLED',
        cancelled_at = now(),
        updated_at = now()
    WHERE id = reservation_row.id;

    FOR ledger_group IN
        SELECT
            cl.customer_entitlement_id,
            cl.academy_membership_id,
            cl.student_id,
            COALESCE(SUM(cl.credit_delta), 0)::integer AS net_credit_delta
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = p_tenant_id
          AND cl.reservation_id = p_reservation_id
        GROUP BY cl.customer_entitlement_id, cl.academy_membership_id, cl.student_id
    LOOP
        IF ledger_group.net_credit_delta < 0 THEN
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
            VALUES (
                p_tenant_id,
                ledger_group.customer_entitlement_id,
                ledger_group.academy_membership_id,
                ledger_group.student_id,
                p_reservation_id,
                'REFUND',
                -ledger_group.net_credit_delta,
                now(),
                'cancel',
                'reservation:' || p_reservation_id::text,
                'Parent app cancellation refund.',
                jsonb_build_object('slot_id', reservation_row.slot_id)
            );
        END IF;
    END LOOP;

    IF slot_row.is_cancelled THEN
        RETURN reservation_row.id;
    END IF;

    credit_cost := COALESCE(slot_row.credit_cost, 1);

    SELECT public.slot_spots_taken(p_tenant_id, slot_row.id)
    INTO booked_count;

    IF booked_count >= slot_row.capacity THEN
        RETURN reservation_row.id;
    END IF;

    FOR waitlist_row IN
        SELECT wl.*
        FROM public.waitlist_entries wl
        WHERE wl.tenant_id = p_tenant_id
          AND wl.slot_id = slot_row.id
          AND wl.status = 'WAITING'
        ORDER BY wl.created_at ASC, wl.id ASC
        FOR UPDATE OF wl
    LOOP
        SELECT *
        INTO waitlist_membership_row
        FROM public.academy_memberships
        WHERE id = waitlist_row.membership_id
          AND academy_id = p_tenant_id
        FOR UPDATE;

        IF NOT FOUND OR waitlist_membership_row.status <> 'ACTIVE' THEN
            CONTINUE;
        END IF;

        promotion_student_id := COALESCE(waitlist_row.student_id, waitlist_membership_row.student_id);

        IF waitlist_membership_row.student_id IS NOT NULL
           AND promotion_student_id IS DISTINCT FROM waitlist_membership_row.student_id
        THEN
            CONTINUE;
        END IF;

        IF waitlist_membership_row.customer_id IS NOT NULL
           AND promotion_student_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM public.students s
               WHERE s.id = promotion_student_id
                 AND s.parent_id = waitlist_membership_row.customer_id
           )
        THEN
            CONTINUE;
        END IF;

        SELECT *
        INTO promotion_entitlement
        FROM public.parent_select_booking_entitlement(
            p_tenant_id,
            waitlist_membership_row.id,
            promotion_student_id,
            slot_row.bookable_program_id,
            credit_cost
        );

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        SELECT *
        INTO existing_promotion_reservation
        FROM public.reservations
        WHERE tenant_id = p_tenant_id
          AND slot_id = slot_row.id
          AND membership_id = waitlist_membership_row.id
        FOR UPDATE;

        IF FOUND AND existing_promotion_reservation.status = 'CONFIRMED' THEN
            UPDATE public.waitlist_entries
            SET status = 'PROMOTED',
                promoted_at = now(),
                updated_at = now()
            WHERE id = waitlist_row.id;

            SELECT public.slot_spots_taken(p_tenant_id, slot_row.id)
            INTO booked_count;

            IF booked_count >= slot_row.capacity THEN
                RETURN reservation_row.id;
            END IF;

            CONTINUE;
        END IF;

        IF FOUND AND existing_promotion_reservation.status <> 'CANCELLED' THEN
            CONTINUE;
        END IF;

        SELECT public.slot_spots_taken(p_tenant_id, slot_row.id)
        INTO booked_count;

        IF booked_count >= slot_row.capacity THEN
            RETURN reservation_row.id;
        END IF;

        IF existing_promotion_reservation.id IS NOT NULL THEN
            UPDATE public.reservations
            SET status = 'CONFIRMED',
                student_id = promotion_student_id,
                booked_at = now(),
                cancelled_at = null,
                location_id = slot_row.location_id,
                updated_at = now()
            WHERE id = existing_promotion_reservation.id
            RETURNING id INTO promotion_reservation_id;
        ELSE
            INSERT INTO public.reservations (
                tenant_id,
                slot_id,
                membership_id,
                student_id,
                status,
                booked_at,
                cancelled_at,
                location_id
            )
            VALUES (
                p_tenant_id,
                slot_row.id,
                waitlist_membership_row.id,
                promotion_student_id,
                'CONFIRMED',
                now(),
                null,
                slot_row.location_id
            )
            RETURNING id INTO promotion_reservation_id;
        END IF;

        IF credit_cost > 0 AND NOT promotion_entitlement.entitlement_is_unlimited THEN
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
            VALUES (
                p_tenant_id,
                promotion_entitlement.customer_entitlement_id,
                waitlist_membership_row.id,
                promotion_student_id,
                promotion_reservation_id,
                'DEBIT',
                -credit_cost,
                now(),
                'booking',
                'reservation:' || promotion_reservation_id::text,
                'Parent app waitlist promotion debit.',
                jsonb_build_object(
                    'slot_id', slot_row.id,
                    'credit_cost', credit_cost,
                    'waitlist_entry_id', waitlist_row.id
                )
            );
        END IF;

        UPDATE public.waitlist_entries
        SET status = 'PROMOTED',
            promoted_at = now(),
            updated_at = now()
        WHERE id = waitlist_row.id;

        RETURN reservation_row.id;
    END LOOP;

    RETURN reservation_row.id;
END;
$$;

DO $$
DECLARE
    duplicate_keys jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            slot_template_id,
            start_time,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.schedule_slots
        GROUP BY tenant_id, slot_template_id, start_time
        HAVING count(*) > 1
        ORDER BY tenant_id, slot_template_id, start_time
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_schedule_slots_template_start; duplicate generated schedule slots: %', duplicate_keys;
    END IF;
END $$;

-- Purpose: makes slot generation idempotent; generated slots conflict-skip
-- instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_slots_template_start
    ON public.schedule_slots USING btree (tenant_id, slot_template_id, start_time);

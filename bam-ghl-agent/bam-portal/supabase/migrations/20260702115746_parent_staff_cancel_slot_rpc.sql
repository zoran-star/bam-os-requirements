-- Staff slot cancellation RPC.
--
-- Notifications are wired later; when trial_bookings exists, active trial
-- bookings for the slot must also be cancelled here.

CREATE OR REPLACE FUNCTION public.staff_cancel_slot(
    p_tenant_id uuid,
    p_slot_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS TABLE (
    reservations_cancelled integer,
    credits_refunded integer,
    waitlist_cancelled integer
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

    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_cancel_slot(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cancel_slot(uuid, uuid, text) TO service_role;

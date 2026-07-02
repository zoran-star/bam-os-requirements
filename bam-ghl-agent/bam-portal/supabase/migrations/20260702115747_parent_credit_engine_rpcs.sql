-- Parent credit engine RPCs.
--
-- These functions keep Stripe paid-period grants and lapsed-entitlement expiry
-- transactional with the same customer_entitlements row lock used by booking
-- debits, so rollover/expiry cannot race an in-flight booking.

CREATE OR REPLACE FUNCTION public.apply_stripe_credit_grant(
    p_tenant_id uuid,
    p_customer_entitlement_id uuid,
    p_source_ref text,
    p_amount integer,
    p_period_start timestamptz,
    p_period_end timestamptz,
    p_rollover text DEFAULT 'EXPIRE'
)
RETURNS TABLE (
    granted boolean,
    expired_credits integer,
    balance integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    entitlement_row public.customer_entitlements%ROWTYPE;
    current_balance integer;
    expire_source_ref text;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Credit grant amount must be positive.';
    END IF;

    IF p_source_ref IS NULL OR btrim(p_source_ref) = '' THEN
        RAISE EXCEPTION 'sourceRef is required for idempotent Stripe credit grants.';
    END IF;

    IF p_rollover IS NULL OR p_rollover NOT IN ('EXPIRE', 'CARRY_OVER') THEN
        RAISE EXCEPTION 'Credit rollover must be EXPIRE or CARRY_OVER.';
    END IF;

    IF p_period_start IS NULL
       OR p_period_end IS NULL
       OR p_period_end <= p_period_start
    THEN
        RAISE EXCEPTION 'Credit grant period end must be after period start.';
    END IF;

    SELECT ce.*
    INTO entitlement_row
    FROM public.customer_entitlements ce
    WHERE ce.tenant_id = p_tenant_id
      AND ce.id = p_customer_entitlement_id
    FOR UPDATE OF ce;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer entitlement not found.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = p_tenant_id
          AND cl.customer_entitlement_id = p_customer_entitlement_id
          AND cl.entry_type = 'GRANT'
          AND cl.source = 'stripe'
          AND cl.source_ref = p_source_ref
    ) THEN
        SELECT COALESCE(SUM(cl.credit_delta), 0)::integer
        INTO balance
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = p_tenant_id
          AND cl.customer_entitlement_id = p_customer_entitlement_id;

        granted := false;
        expired_credits := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    expired_credits := 0;

    IF p_rollover = 'EXPIRE' THEN
        SELECT COALESCE(SUM(cl.credit_delta), 0)::integer
        INTO current_balance
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = p_tenant_id
          AND cl.customer_entitlement_id = p_customer_entitlement_id;

        IF current_balance > 0 THEN
            expire_source_ref := 'entitlement_period:'
                || p_customer_entitlement_id::text
                || ':'
                || to_char(
                    p_period_start AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                );

            WITH inserted_expiry AS (
                INSERT INTO public.credit_ledger (
                    tenant_id,
                    customer_entitlement_id,
                    academy_membership_id,
                    student_id,
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
                    entitlement_row.id,
                    entitlement_row.academy_membership_id,
                    entitlement_row.student_id,
                    'EXPIRE',
                    -current_balance,
                    p_period_start,
                    'admin',
                    expire_source_ref,
                    'Period rollover expiry.',
                    jsonb_build_object(
                        'period_start', p_period_start,
                        'period_end', p_period_end
                    )
                )
                ON CONFLICT (tenant_id, customer_entitlement_id, source_ref)
                    WHERE entry_type = 'EXPIRE'
                      AND source_ref IS NOT NULL
                DO NOTHING
                RETURNING -credit_delta AS expired_amount
            )
            SELECT COALESCE(SUM(inserted_expiry.expired_amount), 0)::integer
            INTO expired_credits
            FROM inserted_expiry;
        END IF;
    END IF;

    INSERT INTO public.credit_ledger (
        tenant_id,
        customer_entitlement_id,
        academy_membership_id,
        student_id,
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
        entitlement_row.id,
        entitlement_row.academy_membership_id,
        entitlement_row.student_id,
        'GRANT',
        p_amount,
        p_period_start,
        'stripe',
        p_source_ref,
        'Stripe invoice credit grant.',
        jsonb_build_object(
            'period_start', p_period_start,
            'period_end', p_period_end
        )
    );

    SELECT COALESCE(SUM(cl.credit_delta), 0)::integer
    INTO balance
    FROM public.credit_ledger cl
    WHERE cl.tenant_id = p_tenant_id
      AND cl.customer_entitlement_id = p_customer_entitlement_id;

    granted := true;
    RETURN NEXT;
    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_lapsed_credit_entitlements(
    p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (
    entitlement_id uuid,
    expired_credits integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    entitlement_row public.customer_entitlements%ROWTYPE;
    current_balance integer;
    inserted_expired_credits integer;
    expire_source_ref text;
BEGIN
    FOR entitlement_row IN
        SELECT ce.*
        FROM public.customer_entitlements ce
        WHERE (p_tenant_id IS NULL OR ce.tenant_id = p_tenant_id)
          AND ce.entitlement_kind <> 'UNLIMITED_BOOKING'
          AND (
              (ce.valid_until IS NOT NULL AND ce.valid_until < now())
              OR ce.status IN ('EXPIRED', 'CANCELLED')
          )
        ORDER BY ce.tenant_id, ce.id
        FOR UPDATE OF ce SKIP LOCKED
    LOOP
        IF entitlement_row.config ->> 'credit_rollover' = 'CARRY_OVER' THEN
            CONTINUE;
        END IF;

        SELECT COALESCE(SUM(cl.credit_delta), 0)::integer
        INTO current_balance
        FROM public.credit_ledger cl
        WHERE cl.tenant_id = entitlement_row.tenant_id
          AND cl.customer_entitlement_id = entitlement_row.id;

        IF current_balance <= 0 THEN
            CONTINUE;
        END IF;

        expire_source_ref := 'entitlement_lapsed:'
            || entitlement_row.id::text
            || ':'
            || to_char(
                COALESCE(entitlement_row.valid_until, now()) AT TIME ZONE 'UTC',
                'YYYY-MM-DD'
            );

        WITH inserted_expiry AS (
            INSERT INTO public.credit_ledger (
                tenant_id,
                customer_entitlement_id,
                academy_membership_id,
                student_id,
                entry_type,
                credit_delta,
                effective_at,
                source,
                source_ref,
                notes,
                metadata
            )
            VALUES (
                entitlement_row.tenant_id,
                entitlement_row.id,
                entitlement_row.academy_membership_id,
                entitlement_row.student_id,
                'EXPIRE',
                -current_balance,
                now(),
                'admin',
                expire_source_ref,
                'Lapsed entitlement credit expiry.',
                jsonb_build_object(
                    'valid_until', entitlement_row.valid_until,
                    'status', entitlement_row.status
                )
            )
            ON CONFLICT (tenant_id, customer_entitlement_id, source_ref)
                WHERE entry_type = 'EXPIRE'
                  AND source_ref IS NOT NULL
            DO NOTHING
            RETURNING -credit_delta AS expired_amount
        )
        SELECT COALESCE(SUM(inserted_expiry.expired_amount), 0)::integer
        INTO inserted_expired_credits
        FROM inserted_expiry;

        IF inserted_expired_credits > 0 THEN
            entitlement_id := entitlement_row.id;
            expired_credits := inserted_expired_credits;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_credit_grant(uuid, uuid, text, integer, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_lapsed_credit_entitlements(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_stripe_credit_grant(uuid, uuid, text, integer, timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_credit_entitlements(uuid) TO service_role;

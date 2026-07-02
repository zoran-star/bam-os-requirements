-- Parent identity uniqueness guards.
--
-- These indexes make parent identity matching and credit-expiry retries safe
-- to rerun. The academy membership and member link relationships are already
-- protected by unique constraints in the identity migration.

DO $$
DECLARE
    duplicate_keys jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            lower(email) AS email_norm,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.customer_profiles
        GROUP BY lower(email)
        HAVING count(*) > 1
        ORDER BY lower(email)
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_customer_profiles_email_norm; duplicate normalized customer profile emails: %', duplicate_keys;
    END IF;

    SELECT jsonb_agg(to_jsonb(d))
    INTO duplicate_keys
    FROM (
        SELECT
            tenant_id,
            customer_entitlement_id,
            source_ref,
            count(*) AS duplicate_count,
            array_agg(id ORDER BY id) AS ids
        FROM public.credit_ledger
        WHERE entry_type = 'EXPIRE'
          AND source_ref IS NOT NULL
        GROUP BY tenant_id, customer_entitlement_id, source_ref
        HAVING count(*) > 1
        ORDER BY tenant_id, customer_entitlement_id, source_ref
        LIMIT 20
    ) d;

    IF duplicate_keys IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot add uq_credit_ledger_expire_ref; duplicate expire ledger refs: %', duplicate_keys;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_profiles_email_norm
    ON public.customer_profiles USING btree (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_expire_ref
    ON public.credit_ledger USING btree (tenant_id, customer_entitlement_id, source_ref)
    WHERE entry_type = 'EXPIRE'
      AND source_ref IS NOT NULL;

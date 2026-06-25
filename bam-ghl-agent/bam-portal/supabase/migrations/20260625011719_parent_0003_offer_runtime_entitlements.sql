-- Parent-domain migration 0003 — Offer runtime entitlements.
-- Spec: fc-mobile/docs/parent-app-architecture-plan.md
--
-- This lands the parent-owned commerce runtime tables for parent V1:
--   * offer_options
--   * offer_prices
--   * entitlement_templates
--   * customer_entitlements
--   * credit_ledger
--
-- Phase-one rule: these tables can run independently of Business Blueprint
-- `offers`, `offer_teams`, and `pricing_catalog`. Lineage columns are nullable
-- soft references for the later reconciliation, with no FK to shared Offer tables.
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
        WHERE conname = 'uq_reservations_id_tenant'
          AND conrelid = 'public.reservations'::regclass
    ) THEN
        ALTER TABLE public.reservations
            ADD CONSTRAINT uq_reservations_id_tenant UNIQUE (id, tenant_id);
    END IF;
END;
$$;

-- ── 1. offer_options — parent runtime purchasable option ──────────────────

CREATE TABLE IF NOT EXISTS public.offer_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    title text NOT NULL,
    offer_type text NOT NULL CHECK (
        offer_type IN ('TRAINING', 'TEAM', 'CAMP_CLINIC', 'LEAGUE', 'TOURNAMENT', 'GYM_RENTAL')
    ),
    purchase_kind text NOT NULL CHECK (
        purchase_kind IN ('MEMBERSHIP', 'CREDIT_PACK', 'EVENT_REGISTRATION', 'TEAM_REGISTRATION', 'RENTAL_BOOKING')
    ),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    description text,
    source_offer_id uuid,
    source_offer_option_key text,
    source_offer_team_id uuid,
    source_offer_team_key text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_offer_options_id_tenant UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS ix_offer_options_tenant_status
    ON public.offer_options USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_offer_options_tenant_type
    ON public.offer_options USING btree (tenant_id, offer_type, purchase_kind);
CREATE INDEX IF NOT EXISTS ix_offer_options_source_offer
    ON public.offer_options USING btree (source_offer_id, source_offer_option_key);
CREATE INDEX IF NOT EXISTS ix_offer_options_source_team
    ON public.offer_options USING btree (source_offer_team_id, source_offer_team_key);

-- ── 2. offer_prices — parent runtime price rows ───────────────────────────

CREATE TABLE IF NOT EXISTS public.offer_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    offer_option_id uuid NOT NULL,
    title text NOT NULL,
    amount_cents integer NOT NULL CHECK (amount_cents >= 0),
    currency text NOT NULL DEFAULT 'cad',
    billing_interval text,
    stripe_price_id text,
    stripe_product_id text,
    source_offer_id uuid,
    source_offer_price_key text,
    source_pricing_catalog_id uuid,
    is_active boolean NOT NULL DEFAULT true,
    is_routable boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_offer_prices_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT fk_offer_prices_option_tenant
        FOREIGN KEY (offer_option_id, tenant_id)
        REFERENCES public.offer_options(id, tenant_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_offer_prices_tenant_active
    ON public.offer_prices USING btree (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS ix_offer_prices_offer_option
    ON public.offer_prices USING btree (offer_option_id);
CREATE INDEX IF NOT EXISTS ix_offer_prices_stripe_price
    ON public.offer_prices USING btree (stripe_price_id);
CREATE INDEX IF NOT EXISTS ix_offer_prices_source_offer
    ON public.offer_prices USING btree (source_offer_id, source_offer_price_key);
CREATE INDEX IF NOT EXISTS ix_offer_prices_source_catalog
    ON public.offer_prices USING btree (source_pricing_catalog_id);

-- ── 3. entitlement_templates — what a price grants ────────────────────────

CREATE TABLE IF NOT EXISTS public.entitlement_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    offer_price_id uuid NOT NULL,
    entitlement_kind text NOT NULL CHECK (
        entitlement_kind IN ('WEEKLY_CREDITS', 'UNLIMITED_BOOKING', 'CREDIT_PACK', 'EVENT_REGISTRATION', 'TEAM_REGISTRATION', 'RENTAL_BOOKING')
    ),
    scope_type text CHECK (
        scope_type IN ('STUDENT', 'CUSTOMER', 'TEAM', 'EVENT', 'LOCATION') OR scope_type IS NULL
    ),
    credits_per_period integer CHECK (credits_per_period IS NULL OR credits_per_period >= 0),
    credit_period text CHECK (
        credit_period IN ('WEEK', 'FOUR_WEEKS', 'MONTH', 'TERM', 'NONE') OR credit_period IS NULL
    ),
    is_unlimited boolean NOT NULL DEFAULT false,
    credit_cost_policy text CHECK (
        credit_cost_policy IN ('PER_SLOT_CREDIT_COST', 'ONE_CREDIT_PER_BOOKING', 'FREE') OR credit_cost_policy IS NULL
    ),
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_entitlement_templates_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT fk_entitlement_templates_price_tenant
        FOREIGN KEY (offer_price_id, tenant_id)
        REFERENCES public.offer_prices(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT ck_entitlement_template_credit_shape CHECK (
        (entitlement_kind = 'WEEKLY_CREDITS' AND credits_per_period IS NOT NULL AND credit_period IS NOT NULL AND is_unlimited = false) OR
        (entitlement_kind = 'UNLIMITED_BOOKING' AND is_unlimited = true) OR
        (entitlement_kind NOT IN ('WEEKLY_CREDITS', 'UNLIMITED_BOOKING'))
    )
);

CREATE INDEX IF NOT EXISTS ix_entitlement_templates_tenant_status
    ON public.entitlement_templates USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_entitlement_templates_offer_price
    ON public.entitlement_templates USING btree (offer_price_id);
CREATE INDEX IF NOT EXISTS ix_entitlement_templates_kind
    ON public.entitlement_templates USING btree (tenant_id, entitlement_kind);

-- ── 4. customer_entitlements — actual granted access ──────────────────────

CREATE TABLE IF NOT EXISTS public.customer_entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    academy_membership_id uuid NOT NULL,
    customer_id uuid REFERENCES public.customer_profiles(id) ON DELETE SET NULL,
    student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
    scope_type text CHECK (
        scope_type IN ('STUDENT', 'CUSTOMER', 'TEAM', 'EVENT', 'LOCATION') OR scope_type IS NULL
    ),
    scope_id uuid,
    entitlement_kind text NOT NULL CHECK (
        entitlement_kind IN ('WEEKLY_CREDITS', 'UNLIMITED_BOOKING', 'CREDIT_PACK', 'EVENT_REGISTRATION', 'TEAM_REGISTRATION', 'RENTAL_BOOKING')
    ),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'seed', 'stripe', 'import', 'admin')),
    source_offer_price_id uuid,
    source_entitlement_template_id uuid,
    source_ref text,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_customer_entitlements_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT ck_customer_entitlements_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT fk_customer_entitlements_membership_tenant
        FOREIGN KEY (academy_membership_id, tenant_id)
        REFERENCES public.academy_memberships(id, academy_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_customer_entitlements_price_tenant
        FOREIGN KEY (source_offer_price_id, tenant_id)
        REFERENCES public.offer_prices(id, tenant_id)
        ON DELETE SET NULL (source_offer_price_id),
    CONSTRAINT fk_customer_entitlements_template_tenant
        FOREIGN KEY (source_entitlement_template_id, tenant_id)
        REFERENCES public.entitlement_templates(id, tenant_id)
        ON DELETE SET NULL (source_entitlement_template_id)
);

CREATE INDEX IF NOT EXISTS ix_customer_entitlements_membership
    ON public.customer_entitlements USING btree (academy_membership_id);
CREATE INDEX IF NOT EXISTS ix_customer_entitlements_student
    ON public.customer_entitlements USING btree (student_id);
CREATE INDEX IF NOT EXISTS ix_customer_entitlements_customer
    ON public.customer_entitlements USING btree (customer_id);
CREATE INDEX IF NOT EXISTS ix_customer_entitlements_tenant_status
    ON public.customer_entitlements USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_customer_entitlements_kind
    ON public.customer_entitlements USING btree (tenant_id, entitlement_kind);
CREATE INDEX IF NOT EXISTS ix_customer_entitlements_validity
    ON public.customer_entitlements USING btree (tenant_id, valid_from, valid_until);

-- ── 5. credit_ledger — append-only credit movements ───────────────────────

CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    customer_entitlement_id uuid NOT NULL,
    academy_membership_id uuid NOT NULL,
    student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
    reservation_id uuid,
    entry_type text NOT NULL CHECK (
        entry_type IN ('GRANT', 'DEBIT', 'REFUND', 'EXPIRE', 'ADJUSTMENT')
    ),
    credit_delta integer NOT NULL CHECK (credit_delta <> 0),
    effective_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'seed', 'stripe', 'booking', 'cancel', 'import', 'admin')),
    source_ref text,
    notes text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_credit_ledger_entitlement_tenant
        FOREIGN KEY (customer_entitlement_id, tenant_id)
        REFERENCES public.customer_entitlements(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_credit_ledger_membership_tenant
        FOREIGN KEY (academy_membership_id, tenant_id)
        REFERENCES public.academy_memberships(id, academy_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_credit_ledger_reservation_tenant
        FOREIGN KEY (reservation_id, tenant_id)
        REFERENCES public.reservations(id, tenant_id)
        ON DELETE SET NULL (reservation_id)
);

CREATE INDEX IF NOT EXISTS ix_credit_ledger_entitlement
    ON public.credit_ledger USING btree (customer_entitlement_id, effective_at);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_membership
    ON public.credit_ledger USING btree (academy_membership_id, effective_at);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_student
    ON public.credit_ledger USING btree (student_id, effective_at);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_tenant_type
    ON public.credit_ledger USING btree (tenant_id, entry_type);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_reservation
    ON public.credit_ledger USING btree (reservation_id);

-- ── updated_at triggers ───────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'offer_options_updated_at'
          AND tgrelid = 'public.offer_options'::regclass
    ) THEN
        CREATE TRIGGER offer_options_updated_at
            BEFORE UPDATE ON public.offer_options
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'offer_prices_updated_at'
          AND tgrelid = 'public.offer_prices'::regclass
    ) THEN
        CREATE TRIGGER offer_prices_updated_at
            BEFORE UPDATE ON public.offer_prices
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'entitlement_templates_updated_at'
          AND tgrelid = 'public.entitlement_templates'::regclass
    ) THEN
        CREATE TRIGGER entitlement_templates_updated_at
            BEFORE UPDATE ON public.entitlement_templates
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'customer_entitlements_updated_at'
          AND tgrelid = 'public.customer_entitlements'::regclass
    ) THEN
        CREATE TRIGGER customer_entitlements_updated_at
            BEFORE UPDATE ON public.customer_entitlements
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

-- ── RLS: deny-all on every parent-domain commerce table ───────────────────
-- Zero policies on purpose. Service-role Vercel fns are the only access path.

ALTER TABLE public.offer_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

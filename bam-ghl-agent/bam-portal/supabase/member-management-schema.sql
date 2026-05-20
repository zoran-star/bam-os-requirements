-- ============================================================
-- Member Management — schema migration
-- Portal Supabase project: jnojmfmpnsfmtqmwhopz
-- Run this in the Supabase SQL Editor.
--
-- Adds the academy member-management layer to the client portal:
-- a per-academy athlete roster + billing-event history, ported from
-- the BAM GTA system (blueprint: /Users/zoransavic/BAM GTA/).
--
-- Every table is scoped to one academy via client_id -> clients(id).
-- Stripe access model: STRIPE CONNECT — each academy is a connected
-- account; the portal acts on its billing with the platform key + the
-- Stripe-Account header. See the clients.stripe_connect_* columns.
--
-- This file is SCHEMA ONLY. Migrating BAM GTA's ~50 existing member
-- rows is a separate step (Phase 1b) — needs read access to GTA's
-- Supabase project oatwstyzxreujgsbmaxr.
--
-- Safe to re-run (idempotent).
-- ============================================================


-- ------------------------------------------------------------
-- 1. clients — Stripe Connect columns
-- ------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_connect_account_id   TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_connect_status       TEXT
  DEFAULT 'not_connected'
  CHECK (stripe_connect_status IN ('not_connected','onboarding','connected','disabled'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_connect_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.stripe_connect_account_id IS
  'Stripe Connect connected-account id (acct_...). The portal acts on this academy''s billing with the platform key + the Stripe-Account header.';


-- ------------------------------------------------------------
-- 2. Enums
--    Only truly universal (billing-state) fields are enum-locked.
--    Academy-specific fields (plan, trainer, archetype) stay TEXT.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM
      ('live','paused','payment_method_required','payment_failed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_type') THEN
    CREATE TYPE cancellation_type AS ENUM ('cancel','pause');
  END IF;
END $$;


-- ------------------------------------------------------------
-- 3. members — the academy's athlete roster
--    GTA reference enums (kept as TEXT here, multi-tenant):
--      archetype:        Underdog/Butterfly/Cruiser/Die Hard/
--                        Caterpillar/Culture Kid/Eeyore
--      parent_archetype: Friendly/Ghost/Chiller/Smotherer/Die Hard/Karen
--      plan:             1/wk · 2/wk · 3/wk · unlmtd
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  athlete_name            TEXT NOT NULL,
  archetype               TEXT,
  trainer                 TEXT,
  group_num               INT,
  plan                    TEXT,
  status                  member_status NOT NULL DEFAULT 'live',
  engagement              TEXT DEFAULT 'consistent'
                            CHECK (engagement IN ('consistent','at_risk')),
  skill_notes             TEXT,
  parent_name             TEXT,
  parent_archetype        TEXT,
  parent_email            TEXT,
  parent_phone            TEXT,                 -- E.164
  stripe_customer_id      TEXT,                 -- within the academy's connected account
  stripe_subscription_id  TEXT,                 -- within the academy's connected account
  ghl_contact_id          TEXT,
  coachiq_member_id       TEXT,
  joined_date             DATE,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);


-- ------------------------------------------------------------
-- 4. cancellations — pause + cancel events (append-only)
--    type=cancel -> cancel_date set; type=pause -> pause_start/end set.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cancellations (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id               UUID REFERENCES members(id) ON DELETE SET NULL,
  athlete_name            TEXT,                 -- denormalized at event time
  archetype               TEXT,
  parent_name             TEXT,
  type                    cancellation_type NOT NULL,
  cancel_date             DATE,                 -- only if type = cancel
  pause_start             DATE,                 -- only if type = pause
  pause_end               DATE,                 -- only if type = pause; null until un-paused
  reason                  TEXT,
  stripe_subscription_id  TEXT,
  stripe_customer_id      TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);


-- ------------------------------------------------------------
-- 5. referrals — /refer audit trail (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  referrer_member_id      UUID REFERENCES members(id) ON DELETE CASCADE,
  referrer_athlete_name   TEXT,                 -- denormalized at event time
  referrer_parent_name    TEXT,
  count                   INT NOT NULL CHECK (count BETWEEN 1 AND 10),
  weeks_added             INT NOT NULL,         -- currently always count * 4
  stripe_subscription_id  TEXT NOT NULL,        -- which sub had trial_end pushed
  old_trial_end           TIMESTAMPTZ,          -- null if sub had no prior trial
  new_trial_end           TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now()
);


-- ------------------------------------------------------------
-- 6. refunds — /refund audit trail (append-only)
--    Stripe is the source of truth for refund state; this is reporting.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id               UUID REFERENCES members(id) ON DELETE SET NULL,
  athlete_name            TEXT,                 -- denormalized at event time
  parent_name             TEXT,
  stripe_charge_id        TEXT NOT NULL,
  stripe_refund_id        TEXT,                 -- set after the Stripe call succeeds
  amount_cents            INT NOT NULL,
  currency                TEXT DEFAULT 'cad',
  reason                  TEXT,
  refund_date             DATE NOT NULL,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);


-- ------------------------------------------------------------
-- 7. member_audit_log — one row per executed billing write
--    The "who did what when" trail. Append-only.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_audit_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id           UUID REFERENCES members(id) ON DELETE SET NULL,
  action_type         TEXT NOT NULL,    -- pause/unpause/cancel/refund/change/payment_link/refer
  args                JSONB,
  performed_by        UUID,             -- auth.users id of the academy user who confirmed
  performed_by_name   TEXT,
  stripe_response     JSONB,            -- what Stripe returned
  db_changes          JSONB,            -- what changed in Supabase
  created_at          TIMESTAMPTZ DEFAULT now()
);


-- ------------------------------------------------------------
-- 8. Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_members_client            ON members (client_id);
CREATE INDEX IF NOT EXISTS idx_members_client_status     ON members (client_id, status);
CREATE INDEX IF NOT EXISTS idx_members_client_name       ON members (client_id, athlete_name);
CREATE INDEX IF NOT EXISTS idx_cancellations_client      ON cancellations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancellations_member      ON cancellations (member_id);
CREATE INDEX IF NOT EXISTS idx_referrals_client          ON referrals (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer        ON referrals (referrer_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_client            ON refunds (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_client              ON member_audit_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_member              ON member_audit_log (member_id);


-- ------------------------------------------------------------
-- 9. updated_at trigger (members)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_members_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_members_updated_at();


-- ------------------------------------------------------------
-- 10. Row-Level Security
--     SELECT: an academy reads only its own rows; staff read all.
--     WRITE : no anon/authenticated policy -> writes go through the
--             API only (service-role key, which bypasses RLS).
-- ------------------------------------------------------------
ALTER TABLE members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_audit_log ENABLE ROW LEVEL SECURITY;

-- members
DROP POLICY IF EXISTS members_select_own_or_staff ON members;
CREATE POLICY members_select_own_or_staff ON members
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid())
  );

-- cancellations
DROP POLICY IF EXISTS cancellations_select_own_or_staff ON cancellations;
CREATE POLICY cancellations_select_own_or_staff ON cancellations
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid())
  );

-- referrals
DROP POLICY IF EXISTS referrals_select_own_or_staff ON referrals;
CREATE POLICY referrals_select_own_or_staff ON referrals
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid())
  );

-- refunds
DROP POLICY IF EXISTS refunds_select_own_or_staff ON refunds;
CREATE POLICY refunds_select_own_or_staff ON refunds
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid())
  );

-- member_audit_log
DROP POLICY IF EXISTS audit_select_own_or_staff ON member_audit_log;
CREATE POLICY audit_select_own_or_staff ON member_audit_log
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM staff WHERE staff.user_id = auth.uid())
  );

-- ============================================================
-- End of migration.
-- ============================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS stripe_connect_status text
  DEFAULT 'not_connected'
  CHECK (stripe_connect_status IN ('not_connected', 'onboarding', 'connected', 'disabled'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS stripe_connect_connected_at timestamptz;

COMMENT ON COLUMN public.clients.stripe_connect_account_id IS
  'Stripe Connect connected-account id (acct_...). The portal acts on this academy''s billing with the platform key + the Stripe-Account header.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE public.member_status AS ENUM (
      'live',
      'paused',
      'payment_method_required',
      'payment_failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_type') THEN
    CREATE TYPE public.cancellation_type AS ENUM ('cancel', 'pause');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  athlete_name text NOT NULL,
  archetype text,
  trainer text,
  group_num integer,
  plan text,
  status public.member_status NOT NULL DEFAULT 'live',
  engagement text DEFAULT 'consistent' CHECK (engagement IN ('consistent', 'at_risk')),
  skill_notes text,
  parent_name text,
  parent_archetype text,
  parent_email text,
  parent_phone text,
  stripe_customer_id text,
  stripe_subscription_id text,
  ghl_contact_id text,
  coachiq_member_id text,
  joined_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cancellations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  athlete_name text,
  archetype text,
  parent_name text,
  type public.cancellation_type NOT NULL,
  cancel_date date,
  pause_start date,
  pause_end date,
  reason text,
  stripe_subscription_id text,
  stripe_customer_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referrer_member_id uuid REFERENCES public.members(id) ON DELETE CASCADE,
  referrer_athlete_name text,
  referrer_parent_name text,
  count integer NOT NULL CHECK (count BETWEEN 1 AND 10),
  weeks_added integer NOT NULL,
  stripe_subscription_id text NOT NULL,
  old_trial_end timestamptz,
  new_trial_end timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  athlete_name text,
  parent_name text,
  stripe_charge_id text NOT NULL,
  stripe_refund_id text,
  amount_cents integer NOT NULL,
  currency text DEFAULT 'cad',
  reason text,
  refund_date date NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  args jsonb,
  performed_by uuid,
  performed_by_name text,
  stripe_response jsonb,
  db_changes jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_client ON public.members (client_id);
CREATE INDEX IF NOT EXISTS idx_members_client_status ON public.members (client_id, status);
CREATE INDEX IF NOT EXISTS idx_members_client_name ON public.members (client_id, athlete_name);
CREATE INDEX IF NOT EXISTS idx_cancellations_client ON public.cancellations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancellations_member ON public.cancellations (member_id);
CREATE INDEX IF NOT EXISTS idx_referrals_client ON public.referrals (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_client ON public.refunds (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_client ON public.member_audit_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_member ON public.member_audit_log (member_id);

CREATE OR REPLACE FUNCTION public.update_members_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER members_updated_at
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.update_members_updated_at();

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_select_own_or_staff ON public.members;
CREATE POLICY members_select_own_or_staff ON public.members
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

DROP POLICY IF EXISTS cancellations_select_own_or_staff ON public.cancellations;
CREATE POLICY cancellations_select_own_or_staff ON public.cancellations
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

DROP POLICY IF EXISTS referrals_select_own_or_staff ON public.referrals;
CREATE POLICY referrals_select_own_or_staff ON public.referrals
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

DROP POLICY IF EXISTS refunds_select_own_or_staff ON public.refunds;
CREATE POLICY refunds_select_own_or_staff ON public.refunds
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

DROP POLICY IF EXISTS audit_select_own_or_staff ON public.member_audit_log;
CREATE POLICY audit_select_own_or_staff ON public.member_audit_log
  FOR SELECT USING (
    client_id IN (SELECT public.my_client_ids())
    OR EXISTS (SELECT 1 FROM public.staff WHERE staff.user_id = auth.uid())
  );

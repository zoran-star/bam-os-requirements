-- Parent identity pre-auth claim support.
--
-- Parent profiles can now be pre-provisioned from existing member/Stripe/GHL
-- data before the parent has created a Supabase Auth user. The first verified
-- OTP login will claim the row by normalized email and set supabase_user_id.

ALTER TABLE public.customer_profiles
    ALTER COLUMN supabase_user_id DROP NOT NULL;

ALTER TABLE public.customer_profiles
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

UPDATE public.customer_profiles
SET claimed_at = COALESCE(claimed_at, updated_at, created_at, now())
WHERE supabase_user_id IS NOT NULL
  AND claimed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ix_customer_profiles_email_normalized
    ON public.customer_profiles USING btree (lower(btrim(email::text)));

COMMENT ON COLUMN public.customer_profiles.supabase_user_id IS
    'Supabase Auth user id once the parent has claimed this profile. NULL means the profile was pre-provisioned and is waiting for verified-email claim.';

COMMENT ON COLUMN public.customer_profiles.claimed_at IS
    'Timestamp when a pre-provisioned customer profile was linked to a verified Supabase Auth user.';

COMMENT ON INDEX public.ix_customer_profiles_email_normalized IS
    'Case-insensitive uniqueness for matching pre-provisioned parent profiles to verified Supabase Auth emails.';

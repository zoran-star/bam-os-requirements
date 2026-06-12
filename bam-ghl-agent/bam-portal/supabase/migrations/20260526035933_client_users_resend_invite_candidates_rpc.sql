
-- Returns client_users rows whose linked auth.users row has never signed in
-- and never confirmed email, with the most-recent outbound timestamp folded
-- in from auth.users (invited_at / confirmation_sent_at / recovery_sent_at)
-- or client_users.last_invite_sent_at if we've already started retrying.
-- Used by the auto-resend-invite cron at /api/clients?action=cron-resend-invites.
-- SECURITY DEFINER because callers (Vercel cron) authenticate with the
-- service-role key already; the function itself does no auth check beyond
-- being callable. Limit guards against runaway result sizes.
CREATE OR REPLACE FUNCTION public.resend_invite_candidates(
  p_hours_since int DEFAULT 20,
  p_max_retries int DEFAULT 7,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  cu_id uuid,
  user_id uuid,
  client_id uuid,
  email text,
  name text,
  retry_count int,
  last_outbound timestamptz,
  business_name text,
  slack_channel_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    cu.id AS cu_id,
    cu.user_id,
    cu.client_id,
    cu.email,
    COALESCE(cu.name, '') AS name,
    COALESCE(cu.invite_retry_count, 0) AS retry_count,
    COALESCE(
      cu.last_invite_sent_at,
      au.recovery_sent_at,
      au.confirmation_sent_at,
      au.invited_at
    ) AS last_outbound,
    COALESCE(c.business_name, '') AS business_name,
    c.slack_channel_id
  FROM public.client_users cu
  JOIN auth.users au ON au.id = cu.user_id
  JOIN public.clients c ON c.id = cu.client_id
  WHERE au.last_sign_in_at IS NULL
    AND au.email_confirmed_at IS NULL
    AND cu.email IS NOT NULL
    AND COALESCE(cu.invite_retry_count, 0) < p_max_retries
    AND cu.email !~* '@(example\.com|example-not-real\.com|test\.|localhost)$'
    AND (
      COALESCE(
        cu.last_invite_sent_at,
        au.recovery_sent_at,
        au.confirmation_sent_at,
        au.invited_at
      ) IS NULL
      OR COALESCE(
        cu.last_invite_sent_at,
        au.recovery_sent_at,
        au.confirmation_sent_at,
        au.invited_at
      ) < NOW() - (p_hours_since || ' hours')::interval
    )
  ORDER BY COALESCE(
    cu.last_invite_sent_at,
    au.recovery_sent_at,
    au.confirmation_sent_at,
    au.invited_at
  ) NULLS FIRST
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.resend_invite_candidates(int, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invite_candidates(int, int, int) TO service_role;
;

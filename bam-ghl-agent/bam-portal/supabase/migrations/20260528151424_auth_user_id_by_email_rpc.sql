-- Server-side helper to look up an auth.users.id by email. Needed
-- because PostgREST doesn't expose the auth schema on this project,
-- so api/clients.js' findAuthUserByEmail (which used Accept-Profile:
-- auth) silently failed and broke the "user already in auth — link
-- them to this client" fallback path.
--
-- SECURITY DEFINER + restricted GRANT means only service_role calls
-- from server-side code can execute this; never exposed to clients.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;;

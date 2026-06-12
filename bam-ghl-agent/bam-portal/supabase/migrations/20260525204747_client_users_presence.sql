
-- Presence tracking on client_users: every ~30s the client portal
-- pings to update last_seen_at on every row for the current user.
-- The staff Clients page reads this to show a green dot beside any
-- client where a NON-BAM-staff member has activity within 2 minutes.

ALTER TABLE public.client_users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS client_users_last_seen_idx
  ON public.client_users(client_id, last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

-- Per-client online flag: TRUE if any active non-BAM-staff client_user
-- has last_seen_at within the last 2 minutes. SECURITY DEFINER so the
-- staff portal can call it via supabase.rpc() without RLS friction.
CREATE OR REPLACE FUNCTION public.clients_online_status()
RETURNS TABLE(client_id uuid, is_online boolean, last_seen_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cu.client_id,
    bool_or(cu.last_seen_at > (now() - interval '2 minutes')) AS is_online,
    max(cu.last_seen_at) AS last_seen_at
  FROM public.client_users cu
  WHERE cu.status = 'active'
    AND cu.user_id IS NOT NULL
    AND cu.last_seen_at IS NOT NULL
    AND cu.user_id NOT IN (
      SELECT s.user_id FROM public.staff s WHERE s.user_id IS NOT NULL
    )
  GROUP BY cu.client_id;
$$;

GRANT EXECUTE ON FUNCTION public.clients_online_status() TO authenticated, anon;
;

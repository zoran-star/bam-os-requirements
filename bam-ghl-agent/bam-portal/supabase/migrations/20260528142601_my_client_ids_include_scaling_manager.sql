-- Extend my_client_ids() so BAM staff who are set as a client's
-- scaling_manager get the same client-portal access as someone in
-- client_users. RLS policies across 18 tables (tickets, messages,
-- offers, members, locations, etc.) already filter via my_client_ids,
-- so a single function change exposes everything correctly.
--
-- Two paths to access:
--   1. client_users membership (existing path — owners, invited teammates)
--   2. staff.user_id matches auth.uid() AND clients.scaling_manager_id
--      points at that staff row (new — scaling managers)

CREATE OR REPLACE FUNCTION public.my_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT client_id FROM public.client_users
   WHERE user_id = auth.uid() AND status = 'active'
  UNION
  SELECT c.id FROM public.clients c
    JOIN public.staff s ON s.id = c.scaling_manager_id
   WHERE s.user_id = auth.uid()
$$;;

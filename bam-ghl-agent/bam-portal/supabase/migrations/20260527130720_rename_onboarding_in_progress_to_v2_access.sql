
-- Rejig 2026-05-27 — the staff "Is onboarding?" toggle becomes the
-- "V2 access" gate. Per Zoran's clarification:
--   - V1 (default everyone): full portal MINUS Members tab
--   - V2 (staff opts in per-client): adds the Members tab
--   - BB nav + onboarding tracker are V1 (visible to everyone)
--
-- Mechanic: rename the column, keep all the timestamps/etc, update the
-- get_onboarding_progress RPC to drop the in_progress flag (tracker is
-- always-on now for clients with any incomplete section), and set
-- BAM GTA's v2_access = true (the only V2 client today).

ALTER TABLE public.clients
  RENAME COLUMN onboarding_in_progress TO v2_access;

-- get_onboarding_progress: the tracker no longer gates on a client
-- flag (V1 = always-visible if incomplete). We keep the function name
-- + shape so the client portal doesn't need a coordinated rename. The
-- 'in_progress' key is now always true — the client treats it as a
-- "render if any incomplete" signal.
CREATE OR REPLACE FUNCTION public.get_onboarding_progress(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_result jsonb;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'client_id', c.id,
    'in_progress', true,                                  -- always: V1 tracker is always-on
    'tracker_dismissed', COALESCE(c.onboarding_tracker_dismissed, false),
    'v2_access', COALESCE(c.v2_access, false),
    'general_done',
      (c.business_name IS NOT NULL AND length(trim(c.business_name)) > 0
       AND c.owner_name IS NOT NULL AND length(trim(c.owner_name)) > 0
       AND c.email IS NOT NULL AND length(trim(c.email)) > 0),
    'staff_done',     (c.staff_marked_done_at IS NOT NULL),
    'locations_done', (c.locations_marked_done_at IS NOT NULL),
    'brand_done',     (c.brand_marked_done_at IS NOT NULL),
    'offers_done',
      EXISTS (
        SELECT 1 FROM offers
        WHERE client_id = c.id AND COALESCE(status,'') <> 'archived'
      ),
    'meta_ads_done',  (c.meta_ads_marked_done_at IS NOT NULL)
  ) INTO v_result
  FROM clients c
  WHERE c.id = p_client_id;
  RETURN v_result;
END;
$$;

-- Flip BAM GTA on (the one V2 client for now).
UPDATE public.clients
   SET v2_access = true
 WHERE id = '39875f07-0a4b-4429-a201-2249bc1f24df';

-- Make sure other clients are explicitly false (the rename preserves
-- existing values; this defensively zeroes out anyone else that had
-- onboarding_in_progress=true under the old semantics).
UPDATE public.clients
   SET v2_access = false
 WHERE id <> '39875f07-0a4b-4429-a201-2249bc1f24df'
   AND v2_access IS NOT FALSE;
;

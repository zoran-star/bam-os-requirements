
-- Stage 3 of the Business Blueprint build — the small floating widget
-- that shows 6 circles in the client portal (General / Staff / Locations /
-- Brand / Offers / Meta Ads). Each circle's done-state is *derived* from
-- data presence rather than stored — single source of truth, no separate
-- onboarding_progress table needed. Only the user's "dismiss" preference
-- is persisted (per-client, since one client can have many users but the
-- widget is a business-level state, not a personal one).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_tracker_dismissed boolean DEFAULT false;

-- Returns a snapshot of the 6 onboarding sections + visibility flags.
-- Called by the client portal on boot + after any BB navigation. RLS
-- bypass via SECURITY DEFINER, but membership is verified by checking
-- p_client_id IS in the caller's my_client_ids() — so a teammate of
-- client A can't probe client B's progress.
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
  -- Authorization: caller must be a member of this client OR be staff.
  SELECT (p_client_id = ANY(my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'client_id', c.id,
    'in_progress', COALESCE(c.onboarding_in_progress, false),
    'tracker_dismissed', COALESCE(c.onboarding_tracker_dismissed, false),
    'general_done',
      (c.business_name IS NOT NULL AND length(trim(c.business_name)) > 0
       AND c.owner_name IS NOT NULL AND length(trim(c.owner_name)) > 0
       AND c.email IS NOT NULL AND length(trim(c.email)) > 0),
    'staff_done',
      EXISTS (
        SELECT 1 FROM client_users
        WHERE client_id = c.id
          AND status = 'active'
          AND COALESCE(role,'') <> 'owner'
      ),
    'locations_done',
      EXISTS (SELECT 1 FROM locations WHERE client_id = c.id),
    'brand_done', false,  -- placeholder until Stage 2 brand card ships
    'offers_done',
      EXISTS (
        SELECT 1 FROM offers
        WHERE client_id = c.id AND COALESCE(status,'') <> 'archived'
      ),
    'meta_ads_done',
      (c.meta_ad_account_id IS NOT NULL AND length(trim(c.meta_ad_account_id)) > 0)
  ) INTO v_result
  FROM clients c
  WHERE c.id = p_client_id;

  RETURN v_result;
END;
$$;

-- Permanent dismissal of the widget for this client. Once dismissed, the
-- widget never reappears (the user goes to BB cards directly if they
-- need to keep working). Both authenticated owners/members AND staff
-- can dismiss it. Returns the updated row count so the client knows
-- whether the call took effect.
CREATE OR REPLACE FUNCTION public.dismiss_onboarding_tracker(p_client_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_updated int := 0;
BEGIN
  SELECT (p_client_id = ANY(my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN 0;
  END IF;

  UPDATE clients
     SET onboarding_tracker_dismissed = true
   WHERE id = p_client_id
     AND COALESCE(onboarding_tracker_dismissed, false) = false;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_onboarding_progress(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_onboarding_tracker(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_onboarding_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_onboarding_tracker(uuid) TO authenticated, service_role;
;

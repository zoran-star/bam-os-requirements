
-- Fix: my_client_ids() returns SETOF uuid, not uuid[] — so the
-- ANY(my_client_ids()) call errors. Use IN (SELECT ...) instead.

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
    'brand_done', false,
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
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
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
;

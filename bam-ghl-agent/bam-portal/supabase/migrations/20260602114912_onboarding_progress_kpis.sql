CREATE OR REPLACE FUNCTION public.get_onboarding_progress(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_authorized boolean;
  v_result jsonb;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'client_id', c.id,
    'in_progress', true,
    'tracker_dismissed', COALESCE(c.onboarding_tracker_dismissed, false),
    'v2_access', COALESCE(c.v2_access, false),
    'ghl_signup_done', (c.ghl_signup_done_at IS NOT NULL),
    'slack_join_done', (c.slack_join_done_at IS NOT NULL),
    'general_done',
      (c.general_marked_done_at IS NOT NULL
       OR (c.business_name IS NOT NULL AND length(trim(c.business_name)) > 0
           AND c.owner_name IS NOT NULL AND length(trim(c.owner_name)) > 0
           AND c.email IS NOT NULL AND length(trim(c.email)) > 0)),
    'staff_done',     (c.staff_marked_done_at IS NOT NULL),
    'locations_done', (c.locations_marked_done_at IS NOT NULL),
    'brand_done',     (c.brand_marked_done_at IS NOT NULL),
    'offers_done',    (c.offers_marked_done_at IS NOT NULL),
    'kpis_done',      (c.kpi_marked_done_at IS NOT NULL),
    'meta_ads_done',  (c.meta_ads_marked_done_at IS NOT NULL)
  ) INTO v_result
  FROM clients c
  WHERE c.id = p_client_id;
  RETURN v_result;
END;
$function$;;

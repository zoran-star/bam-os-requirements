
-- Per Zoran 2026-05-30: staff (SMs) should be able to check every
-- onboarding section off, including the client-driven ones and the
-- auto-derived General. Lets the SM unblock a client who's stuck or
-- mark sections done out-of-band (call confirmed, screenshot received,
-- etc.) without forcing the client through the BB UI.
--
-- General was auto-derived only — add a manual override column so
-- staff can flip it independently. get_onboarding_progress now treats
-- general as done if EITHER the manual flag is set OR all 3 basics
-- are filled (most permissive — staff can override but the auto path
-- still works for clients who fill it in themselves).
--
-- mark_onboarding_section already accepts staff/brand/locations/
-- offers. Adding 'general' to the whitelist. The 2 already-staff
-- sections (ghl_signup, slack_join) and meta_ads stay on their
-- existing paths.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS general_marked_done_at timestamptz;

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
    'meta_ads_done',  (c.meta_ads_marked_done_at IS NOT NULL)
  ) INTO v_result
  FROM clients c
  WHERE c.id = p_client_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_onboarding_section(
  p_client_id uuid,
  p_section   text,
  p_done      boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_col text;
  v_sql text;
  v_value timestamptz;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN false; END IF;

  v_col := CASE p_section
    WHEN 'ghl_signup' THEN 'ghl_signup_done_at'
    WHEN 'slack_join' THEN 'slack_join_done_at'
    WHEN 'general'    THEN 'general_marked_done_at'
    WHEN 'staff'      THEN 'staff_marked_done_at'
    WHEN 'brand'      THEN 'brand_marked_done_at'
    WHEN 'locations'  THEN 'locations_marked_done_at'
    WHEN 'offers'     THEN 'offers_marked_done_at'
    ELSE NULL
  END;
  IF v_col IS NULL THEN RETURN false; END IF;

  v_value := CASE WHEN p_done THEN NOW() ELSE NULL END;
  v_sql := format('UPDATE clients SET %I = $1 WHERE id = $2', v_col);
  EXECUTE v_sql USING v_value, p_client_id;

  RETURN true;
END;
$$;

-- API needs to accept the matching boolean fields. The api/clients.js
-- update-fields branch already handles the existing 3; we'll add the
-- 5 new ones in the same commit on the JS side.
;

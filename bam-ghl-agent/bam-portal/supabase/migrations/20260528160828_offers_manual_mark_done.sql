
-- Per Zoran 2026-05-27: Offers becomes a manual "I'm done" section like
-- Brand / Staff / Locations. The auto-derived "≥1 offer exists" check
-- was too generous — owners can have draft offers in progress without
-- being ready to declare Offers done. New column + RPC updates.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS offers_marked_done_at timestamptz;

-- get_onboarding_progress: offers_done now reads the new column instead
-- of EXISTS-checking the offers table.
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
    'general_done',
      (c.business_name IS NOT NULL AND length(trim(c.business_name)) > 0
       AND c.owner_name IS NOT NULL AND length(trim(c.owner_name)) > 0
       AND c.email IS NOT NULL AND length(trim(c.email)) > 0),
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

-- mark_onboarding_section: now accepts 'offers' in addition to staff /
-- brand / locations. Meta-ads stays staff-only via update-fields API.
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
    WHEN 'staff'     THEN 'staff_marked_done_at'
    WHEN 'brand'     THEN 'brand_marked_done_at'
    WHEN 'locations' THEN 'locations_marked_done_at'
    WHEN 'offers'    THEN 'offers_marked_done_at'
    ELSE NULL
  END;
  IF v_col IS NULL THEN RETURN false; END IF;

  v_value := CASE WHEN p_done THEN NOW() ELSE NULL END;
  v_sql := format('UPDATE clients SET %I = $1 WHERE id = $2', v_col);
  EXECUTE v_sql USING v_value, p_client_id;

  RETURN true;
END;
$$;
;

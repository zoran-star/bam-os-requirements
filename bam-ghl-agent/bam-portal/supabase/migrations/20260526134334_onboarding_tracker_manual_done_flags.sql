
-- Refactor onboarding tracker done-state logic per Zoran's feedback
-- (2026-05-26):
--   staff_done    — client toggles directly by clicking the tracker circle
--   brand_done    — client marks done from the Brand BB card (mark-done btn)
--   meta_ads_done — BAM staff toggles from the staff portal overview tab
--
-- The other three stay data-derived: general (basics filled), locations
-- (>=1 row), offers (>=1 non-archived row). Single source of truth for
-- those, no manual flag drift.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS staff_marked_done_at    timestamptz,
  ADD COLUMN IF NOT EXISTS brand_marked_done_at    timestamptz,
  ADD COLUMN IF NOT EXISTS meta_ads_marked_done_at timestamptz;

-- Replace get_onboarding_progress to read the new manual columns for the
-- 3 sections that need them.
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
      (c.staff_marked_done_at IS NOT NULL),
    'locations_done',
      EXISTS (SELECT 1 FROM locations WHERE client_id = c.id),
    'brand_done',
      (c.brand_marked_done_at IS NOT NULL),
    'offers_done',
      EXISTS (
        SELECT 1 FROM offers
        WHERE client_id = c.id AND COALESCE(status,'') <> 'archived'
      ),
    'meta_ads_done',
      (c.meta_ads_marked_done_at IS NOT NULL)
  ) INTO v_result
  FROM clients c
  WHERE c.id = p_client_id;

  RETURN v_result;
END;
$$;

-- New RPC: mark/un-mark a section as done. Maps section name to the right
-- column, sets to NOW() or NULL based on p_done. Membership check inside.
-- Meta Ads is intentionally NOT settable via this client-callable path —
-- staff sets it via /api/clients?action=update-fields directly (and the
-- column is just timestamptz on the clients row, no RLS gate, since the
-- API verifies staff role).
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

  -- Whitelist sections + map to column. Only staff + brand are
  -- client-flippable. Meta-ads is staff-only (set via update-fields API
  -- with staff auth). Returning false for unknown / non-flippable section.
  v_col := CASE p_section
    WHEN 'staff' THEN 'staff_marked_done_at'
    WHEN 'brand' THEN 'brand_marked_done_at'
    ELSE NULL
  END;
  IF v_col IS NULL THEN RETURN false; END IF;

  v_value := CASE WHEN p_done THEN NOW() ELSE NULL END;
  v_sql := format('UPDATE clients SET %I = $1 WHERE id = $2', v_col);
  EXECUTE v_sql USING v_value, p_client_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_onboarding_section(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_section(uuid, text, boolean) TO authenticated, service_role;
;

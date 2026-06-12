
-- Round 2 of the onboarding-tracker per-section flags. Zoran's clarification
-- (2026-05-26):
--   - staff_done       moved from "toggle on tracker circle" to
--                      "mark-done button on the BB Staff card"
--   - locations_done   moved from auto-derive (>=1 location) to
--                      "mark-done button on the BB Locations card"
--   The tracker circles now just navigate; only Brand/Staff/Locations BB
--   cards can flip their respective flags.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS locations_marked_done_at timestamptz;

-- General BB card needs columns for business basics (legal name, address,
-- phone, EIN, entity type). Owners can already type business_name + email
-- + owner_name during signup — these are the rest of the contact card.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS legal_name   text,
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS entity_type  text,
  ADD COLUMN IF NOT EXISTS ein          text;

-- Brand BB card stores everything as one jsonb blob on the client. Keeps
-- the schema simple — the brand form is small enough (3 colors + 2 logos
-- + 2 fonts + website spec) that a separate brand table would be over-
-- engineering for v1. If brand data grows past ~15 fields, split it then.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brand_data jsonb DEFAULT '{}'::jsonb;

-- get_onboarding_progress: locations_done is now manual (reads the new
-- column), brand/staff/meta_ads stay manual, general/offers stay
-- data-derived.
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
      (c.locations_marked_done_at IS NOT NULL),
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

-- mark_onboarding_section: now accepts 'staff', 'brand', 'locations'.
-- Meta-ads is still staff-only via update-fields API.
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
    ELSE NULL
  END;
  IF v_col IS NULL THEN RETURN false; END IF;

  v_value := CASE WHEN p_done THEN NOW() ELSE NULL END;
  v_sql := format('UPDATE clients SET %I = $1 WHERE id = $2', v_col);
  EXECUTE v_sql USING v_value, p_client_id;

  RETURN true;
END;
$$;

-- Client-facing upsert RPC for the General + Brand BB cards. RLS-safe
-- via my_client_ids() membership check inside.
CREATE OR REPLACE FUNCTION public.update_client_basics(
  p_client_id uuid,
  p_patch     jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN false; END IF;

  -- Whitelist of columns clients can update via this path. Anything not
  -- in this list is silently ignored — same field-whitelist pattern as
  -- the staff-side /api/clients?action=update-fields.
  UPDATE clients SET
    business_name = COALESCE(NULLIF(p_patch->>'business_name', ''), business_name),
    owner_name    = COALESCE(NULLIF(p_patch->>'owner_name', ''),    owner_name),
    email         = COALESCE(NULLIF(p_patch->>'email', ''),         email),
    legal_name    = CASE WHEN p_patch ? 'legal_name'  THEN NULLIF(p_patch->>'legal_name','')  ELSE legal_name  END,
    address       = CASE WHEN p_patch ? 'address'     THEN NULLIF(p_patch->>'address','')     ELSE address     END,
    phone         = CASE WHEN p_patch ? 'phone'       THEN NULLIF(p_patch->>'phone','')       ELSE phone       END,
    entity_type   = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(p_patch->>'entity_type','') ELSE entity_type END,
    ein           = CASE WHEN p_patch ? 'ein'         THEN NULLIF(p_patch->>'ein','')         ELSE ein         END,
    brand_data    = CASE WHEN p_patch ? 'brand_data'  THEN COALESCE(p_patch->'brand_data', brand_data) ELSE brand_data END
  WHERE id = p_client_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_client_basics(uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_client_basics(uuid, jsonb) TO authenticated, service_role;
;

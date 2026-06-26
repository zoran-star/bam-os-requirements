-- Ads content approval gate (per academy).
-- When ON, ads content tickets must be approved by the client before they can
-- reach the marketing team. Client approval auto-sends to marketing.
-- Default false → existing behavior (content sends straight to marketing).
alter table public.clients
  add column if not exists ads_content_approval_required boolean not null default false;

-- Extend the client self-edit RPC whitelist so the academy owner can toggle this
-- from the client portal (Brand section of the business blueprint).
CREATE OR REPLACE FUNCTION public.update_client_basics(p_client_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_authorized boolean;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN false; END IF;

  UPDATE clients SET
    business_name = COALESCE(NULLIF(p_patch->>'business_name', ''), business_name),
    owner_name    = COALESCE(NULLIF(p_patch->>'owner_name', ''),    owner_name),
    email         = COALESCE(NULLIF(p_patch->>'email', ''),         email),
    legal_name    = CASE WHEN p_patch ? 'legal_name'  THEN NULLIF(p_patch->>'legal_name','')  ELSE legal_name  END,
    address       = CASE WHEN p_patch ? 'address'     THEN NULLIF(p_patch->>'address','')     ELSE address     END,
    phone         = CASE WHEN p_patch ? 'phone'       THEN NULLIF(p_patch->>'phone','')       ELSE phone       END,
    entity_type   = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(p_patch->>'entity_type','') ELSE entity_type END,
    ein           = CASE WHEN p_patch ? 'ein'         THEN NULLIF(p_patch->>'ein','')         ELSE ein         END,
    time_zone     = CASE WHEN p_patch ? 'time_zone'   THEN NULLIF(p_patch->>'time_zone','')   ELSE time_zone   END,
    brand_data    = CASE WHEN p_patch ? 'brand_data'  THEN COALESCE(p_patch->'brand_data', brand_data) ELSE brand_data END,
    kpi_data      = CASE WHEN p_patch ? 'kpi_data'    THEN COALESCE(p_patch->'kpi_data', kpi_data)     ELSE kpi_data   END,
    ads_content_approval_required = CASE WHEN p_patch ? 'ads_content_approval_required'
      THEN COALESCE((p_patch->>'ads_content_approval_required')::boolean, ads_content_approval_required)
      ELSE ads_content_approval_required END
  WHERE id = p_client_id;

  RETURN true;
END;
$function$;

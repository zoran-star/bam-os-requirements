-- Onboarding wizard collection pages (PR-2 of the wizard redesign,
-- docs/onboarding-wizard-spec.md): a home for wizard-collected answers that
-- are not brand or offer data - texting number choice, ads choice, contact
-- import source, port details. One jsonb, replaced wholesale on save (the
-- client merges before sending, same contract as brand_data).
alter table clients
  add column if not exists onboarding_setup jsonb default '{}'::jsonb;

-- Extend the client-auth patch RPC with onboarding_setup (based on the
-- 20260626120000 version - keep every existing line intact).
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
    onboarding_setup = CASE WHEN p_patch ? 'onboarding_setup' THEN COALESCE(p_patch->'onboarding_setup', onboarding_setup) ELSE onboarding_setup END,
    ads_content_approval_required = CASE WHEN p_patch ? 'ads_content_approval_required'
      THEN COALESCE((p_patch->>'ads_content_approval_required')::boolean, ads_content_approval_required)
      ELSE ads_content_approval_required END
  WHERE id = p_client_id;

  RETURN true;
END;
$function$;

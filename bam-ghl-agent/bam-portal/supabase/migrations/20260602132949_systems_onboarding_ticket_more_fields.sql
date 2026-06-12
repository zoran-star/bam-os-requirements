CREATE OR REPLACE FUNCTION public.maybe_create_systems_onboarding_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_general_done    boolean;
  v_assignee        uuid;
  v_ticket_id       uuid;
  v_body            jsonb;
  v_staff           jsonb;
  v_locations       jsonb;
  v_offers          jsonb;
BEGIN
  IF NEW.systems_onboarding_ticket_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_general_done := (NEW.business_name IS NOT NULL AND length(trim(NEW.business_name)) > 0
                  AND NEW.owner_name    IS NOT NULL AND length(trim(NEW.owner_name)) > 0
                  AND NEW.email         IS NOT NULL AND length(trim(NEW.email)) > 0);

  IF NOT (v_general_done
          AND NEW.staff_marked_done_at     IS NOT NULL
          AND NEW.locations_marked_done_at IS NOT NULL
          AND NEW.brand_marked_done_at     IS NOT NULL
          AND NEW.offers_marked_done_at    IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_assignee FROM staff
   WHERE role = 'systems_manager'
   ORDER BY created_at ASC NULLS LAST LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cu.id, 'name', cu.name, 'email', cu.email, 'role', cu.role
         ) ORDER BY cu.created_at), '[]'::jsonb)
    INTO v_staff FROM client_users cu
   WHERE cu.client_id = NEW.id AND cu.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', l.title, 'address', l.address, 'notes', l.notes
         ) ORDER BY l.sort_order, l.created_at), '[]'::jsonb)
    INTO v_locations FROM locations l
   WHERE l.client_id = NEW.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'type', o.type, 'title', o.title, 'status', o.status, 'data', o.data
         ) ORDER BY o.sort_order, o.created_at), '[]'::jsonb)
    INTO v_offers FROM offers o
   WHERE o.client_id = NEW.id AND COALESCE(o.status, '') <> 'archived';

  v_body := jsonb_build_object(
    'summary', 'Systems onboarding — ' || COALESCE(NEW.business_name, '(no business name)'),
    'client_id', NEW.id,
    'business_name', NEW.business_name,
    'legal_name',    NEW.legal_name,
    'owner_name',    NEW.owner_name,
    'email',         NEW.email,
    'phone',         NEW.phone,
    'address',       NEW.address,
    'time_zone',     NEW.time_zone,
    'entity_type',   NEW.entity_type,
    'ein',           NEW.ein,
    'website',       NEW.brand_data->>'website_url',
    'domain',        NEW.brand_data->>'domain',
    'marketing_included', COALESCE(NEW.marketing_included, false),
    'slack_channel_id',   NEW.slack_channel_id,
    'ghl', jsonb_build_object(
      'location_id',    NEW.ghl_location_id,
      'company_id',     NEW.ghl_company_id,
      'connect_status', NEW.ghl_connect_status
    ),
    'stripe', jsonb_build_object(
      'account_id',     NEW.stripe_connect_account_id,
      'connect_status', NEW.stripe_connect_status
    ),
    'brand',     COALESCE(NEW.brand_data, '{}'::jsonb),
    'kpis',      COALESCE(NEW.kpi_data, '{}'::jsonb),
    'staff',     v_staff,
    'locations', v_locations,
    'offers',    v_offers,
    'marked_done_at', jsonb_build_object(
      'staff',     NEW.staff_marked_done_at,
      'locations', NEW.locations_marked_done_at,
      'brand',     NEW.brand_marked_done_at,
      'offers',    NEW.offers_marked_done_at
    )
  );

  INSERT INTO tickets (
    client_id, type, status, priority, source, fields, assigned_to,
    submitted_at, updated_at
  ) VALUES (
    NEW.id, 'onboarding', 'open', 'standard', 'portal', v_body, v_assignee,
    NOW(), NOW()
  )
  RETURNING id INTO v_ticket_id;

  UPDATE clients SET systems_onboarding_ticket_id = v_ticket_id WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;;

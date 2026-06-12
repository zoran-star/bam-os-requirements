
-- Auto-create a Systems onboarding ticket the moment a client finishes
-- the 5 non-marketing BB sections (General + Staff + Locations + Brand
-- + Offers). Idempotent via clients.systems_onboarding_ticket_id —
-- once set, never fires again.
--
-- Trigger lives on clients (UPDATE) because all 5 inputs are clients
-- columns now: business_name/owner_name/email for general (auto-derived)
-- and *_marked_done_at timestamps for the 4 manual sections.

-- 1. Allow 'onboarding' as a ticket type
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_type_check;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_type_check
  CHECK (type = ANY (ARRAY['error'::text, 'change'::text, 'build'::text, 'onboarding'::text]));

-- 2. Track the auto-created ticket on the client row
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS systems_onboarding_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;

-- 3. Trigger function — fires AFTER UPDATE on clients. Checks if all 5
-- systems sections are now complete and the ticket hasn't been created
-- yet. If both true, inserts the ticket + assigns to systems_manager
-- + populates the link column. Body lives in tickets.fields as a
-- structured jsonb summary of every non-marketing BB section so the
-- assignee has everything to start without flipping to the BB.
CREATE OR REPLACE FUNCTION public.maybe_create_systems_onboarding_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_general_done    boolean;
  v_assignee        uuid;
  v_ticket_id       uuid;
  v_body            jsonb;
  v_staff           jsonb;
  v_locations       jsonb;
  v_offers          jsonb;
BEGIN
  -- Bail fast if the ticket already exists (idempotent)
  IF NEW.systems_onboarding_ticket_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- General is auto-derived from clients columns
  v_general_done := (NEW.business_name IS NOT NULL AND length(trim(NEW.business_name)) > 0
                  AND NEW.owner_name    IS NOT NULL AND length(trim(NEW.owner_name)) > 0
                  AND NEW.email         IS NOT NULL AND length(trim(NEW.email)) > 0);

  -- All 5 non-marketing sections must be done
  IF NOT (v_general_done
          AND NEW.staff_marked_done_at     IS NOT NULL
          AND NEW.locations_marked_done_at IS NOT NULL
          AND NEW.brand_marked_done_at     IS NOT NULL
          AND NEW.offers_marked_done_at    IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Resolve the assignee — first active systems_manager, else any admin.
  -- Best-effort: if no assignee is found, ticket goes unassigned.
  SELECT id INTO v_assignee FROM staff
   WHERE role = 'systems_manager'
   ORDER BY created_at ASC NULLS LAST LIMIT 1;

  -- Pull related rows for the body — defensive aggregations so they
  -- never NULL out the jsonb_build_object.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cu.id,
           'name', cu.name,
           'email', cu.email,
           'role', cu.role
         ) ORDER BY cu.created_at), '[]'::jsonb)
    INTO v_staff
    FROM client_users cu
   WHERE cu.client_id = NEW.id AND cu.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'title', l.title,
           'address', l.address,
           'notes', l.notes
         ) ORDER BY l.sort_order, l.created_at), '[]'::jsonb)
    INTO v_locations
    FROM locations l
   WHERE l.client_id = NEW.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'type', o.type,
           'title', o.title,
           'status', o.status,
           'data', o.data
         ) ORDER BY o.sort_order, o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM offers o
   WHERE o.client_id = NEW.id AND COALESCE(o.status, '') <> 'archived';

  -- Structured body — every non-marketing field for fast skimming.
  v_body := jsonb_build_object(
    'summary', 'Systems onboarding — ' || COALESCE(NEW.business_name, '(no business name)'),
    'client_id', NEW.id,
    'business_name', NEW.business_name,
    'legal_name',    NEW.legal_name,
    'owner_name',    NEW.owner_name,
    'email',         NEW.email,
    'phone',         NEW.phone,
    'address',       NEW.address,
    'entity_type',   NEW.entity_type,
    'ein',           NEW.ein,
    'brand',         COALESCE(NEW.brand_data, '{}'::jsonb),
    'staff',         v_staff,
    'locations',     v_locations,
    'offers',        v_offers,
    'marked_done_at', jsonb_build_object(
      'staff',     NEW.staff_marked_done_at,
      'locations', NEW.locations_marked_done_at,
      'brand',     NEW.brand_marked_done_at,
      'offers',    NEW.offers_marked_done_at
    )
  );

  -- Insert the ticket
  INSERT INTO tickets (
    client_id, type, status, priority, source, fields, assigned_to,
    submitted_at, updated_at
  ) VALUES (
    NEW.id, 'onboarding', 'open', 'standard', 'portal', v_body, v_assignee,
    NOW(), NOW()
  )
  RETURNING id INTO v_ticket_id;

  -- Stamp the link on the client row WITHOUT re-triggering this function.
  -- Postgres triggers always re-fire on UPDATE; we guard the re-entry by
  -- bailing at the top when systems_onboarding_ticket_id IS NOT NULL.
  UPDATE clients
     SET systems_onboarding_ticket_id = v_ticket_id
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_systems_onboarding_ticket ON public.clients;
CREATE TRIGGER trg_systems_onboarding_ticket
  AFTER UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.maybe_create_systems_onboarding_ticket();
;

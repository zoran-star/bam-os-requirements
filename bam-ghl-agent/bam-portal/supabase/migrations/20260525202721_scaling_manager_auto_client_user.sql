
-- ─────────────────────────────────────────────────────────────────
-- Auto-add scaling manager to client_users
-- Whenever clients.scaling_manager_id is set (INSERT or UPDATE), the
-- referenced staff member is added to client_users with role='member',
-- status='active'. No-op if the staff member doesn't have a portal
-- auth user yet (user_id IS NULL on staff row).
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_scaling_manager_to_client_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_name    text;
  v_email   text;
BEGIN
  IF NEW.scaling_manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATE, skip if scaling_manager_id didn't actually change
  IF TG_OP = 'UPDATE'
     AND OLD.scaling_manager_id IS NOT DISTINCT FROM NEW.scaling_manager_id THEN
    RETURN NEW;
  END IF;

  SELECT user_id, name, email
    INTO v_user_id, v_name, v_email
  FROM public.staff
  WHERE id = NEW.scaling_manager_id;

  -- Skip if staff has no portal auth user yet — they'll need one before
  -- they can log into the client portal anyway
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_users (user_id, client_id, name, email, role, status)
  VALUES (v_user_id, NEW.id, v_name, v_email, 'member', 'active')
  ON CONFLICT (user_id, client_id) DO UPDATE
    SET status = 'active';  -- reactivate if previously revoked

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_auto_add_scaling_manager ON public.clients;
CREATE TRIGGER clients_auto_add_scaling_manager
  AFTER INSERT OR UPDATE OF scaling_manager_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.add_scaling_manager_to_client_users();

-- ─────────────────────────────────────────────────────────────────
-- Backfill: insert client_users for every (scaling_manager, client)
-- combination that doesn't already have a row. Reactivate revoked rows.
-- ─────────────────────────────────────────────────────────────────
INSERT INTO public.client_users (user_id, client_id, name, email, role, status)
SELECT s.user_id, c.id, s.name, s.email, 'member', 'active'
FROM public.clients c
JOIN public.staff s ON s.id = c.scaling_manager_id
WHERE c.archived_at IS NULL
  AND s.user_id IS NOT NULL
ON CONFLICT (user_id, client_id) DO UPDATE
  SET status = 'active';
;

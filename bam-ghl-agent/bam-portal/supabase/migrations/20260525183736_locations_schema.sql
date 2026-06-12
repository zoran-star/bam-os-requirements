
CREATE TABLE public.locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  address     text,
  notes       text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX locations_client_id_idx ON public.locations(client_id);
CREATE INDEX locations_sort_idx ON public.locations(client_id, sort_order, created_at DESC);

-- Reuse the offers updated_at trigger function
CREATE TRIGGER locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_client_read"   ON public.locations
  FOR SELECT  USING (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "locations_client_insert" ON public.locations
  FOR INSERT  WITH CHECK (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "locations_client_update" ON public.locations
  FOR UPDATE  USING (client_id IN (SELECT my_client_ids()) OR is_staff())
              WITH CHECK (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "locations_client_delete" ON public.locations
  FOR DELETE  USING (client_id IN (SELECT my_client_ids()) OR is_staff());
;

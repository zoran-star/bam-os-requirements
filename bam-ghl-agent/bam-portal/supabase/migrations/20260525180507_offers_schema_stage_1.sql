
-- ═══════════════════════════════════════════════════════════════════
-- Business Blueprint > Offers — Stage 1 schema
-- One unified offers table powering the 6 offer types via JSONB
-- ═══════════════════════════════════════════════════════════════════

-- One row per offer
CREATE TABLE public.offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('training','team','camp_clinic','league','tournament','gym_rental')),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offers_client_id_idx  ON public.offers(client_id);
CREATE INDEX offers_type_idx       ON public.offers(type);
CREATE INDEX offers_sort_order_idx ON public.offers(client_id, sort_order, created_at DESC);

-- Per-team rows for Team offers (nested Block Builder backing)
CREATE TABLE public.offer_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  title       text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offer_teams_offer_id_idx ON public.offer_teams(offer_id, sort_order);

-- Files attached to an offer (agreements, assets, onboarding messaging)
CREATE TABLE public.offer_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES public.offer_teams(id) ON DELETE CASCADE,
  section       text NOT NULL,
  filename      text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offer_files_offer_id_idx ON public.offer_files(offer_id);
CREATE INDEX offer_files_team_id_idx  ON public.offer_files(team_id) WHERE team_id IS NOT NULL;

-- updated_at trigger (reuse Resources' pattern)
CREATE OR REPLACE FUNCTION public.offers_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER offers_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();

CREATE TRIGGER offer_teams_updated_at
  BEFORE UPDATE ON public.offer_teams
  FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- RLS
-- Clients see their own; staff bypass via is_staff()
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.offers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_teams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_files  ENABLE ROW LEVEL SECURITY;

-- offers
CREATE POLICY "offers_client_read"   ON public.offers
  FOR SELECT  USING (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "offers_client_insert" ON public.offers
  FOR INSERT  WITH CHECK (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "offers_client_update" ON public.offers
  FOR UPDATE  USING (client_id IN (SELECT my_client_ids()) OR is_staff())
              WITH CHECK (client_id IN (SELECT my_client_ids()) OR is_staff());
CREATE POLICY "offers_client_delete" ON public.offers
  FOR DELETE  USING (client_id IN (SELECT my_client_ids()) OR is_staff());

-- offer_teams — scoped via parent offer's client_id
CREATE POLICY "offer_teams_client_read"   ON public.offer_teams
  FOR SELECT  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_teams_client_insert" ON public.offer_teams
  FOR INSERT  WITH CHECK (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_teams_client_update" ON public.offer_teams
  FOR UPDATE  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff())
              WITH CHECK (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_teams_client_delete" ON public.offer_teams
  FOR DELETE  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());

-- offer_files — scoped via parent offer's client_id
CREATE POLICY "offer_files_client_read"   ON public.offer_files
  FOR SELECT  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_files_client_insert" ON public.offer_files
  FOR INSERT  WITH CHECK (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_files_client_update" ON public.offer_files
  FOR UPDATE  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff())
              WITH CHECK (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
CREATE POLICY "offer_files_client_delete" ON public.offer_files
  FOR DELETE  USING (offer_id IN (SELECT id FROM public.offers WHERE client_id IN (SELECT my_client_ids())) OR is_staff());
;

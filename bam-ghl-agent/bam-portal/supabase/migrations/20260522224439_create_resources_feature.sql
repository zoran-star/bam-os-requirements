
-- ─────────────────────────────────────────────────────────
-- RESOURCES FEATURE
-- Staff (admin only) publishes resources. Clients browse.
-- ─────────────────────────────────────────────────────────

-- Categories (configurable, seeded with 5)
CREATE TABLE public.resource_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#E8C547',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Resources
CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category_id uuid NOT NULL REFERENCES public.resource_categories(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resources_category_id_idx ON public.resources(category_id);
CREATE INDEX resources_created_at_idx  ON public.resources(created_at DESC);

-- Files attached to a resource (1+)
CREATE TABLE public.resource_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  filename text NOT NULL,        -- original filename for display/download
  storage_path text NOT NULL,    -- path inside the 'resources' bucket
  mime_type text,
  size_bytes bigint,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resource_files_resource_id_idx ON public.resource_files(resource_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.resources_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resources_updated_at
  BEFORE UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.resources_set_updated_at();

-- ─────────────────────────────────────────────────────────
-- RLS
-- All authenticated/anon clients can SELECT (read all).
-- Only authenticated staff with role='admin' can write.
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.resource_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_files      ENABLE ROW LEVEL SECURITY;

-- Helper: is the current authenticated user an admin staff member?
CREATE OR REPLACE FUNCTION public.is_admin_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- SELECT: anyone authenticated OR anon
CREATE POLICY "resource_categories_select_all" ON public.resource_categories
  FOR SELECT USING (true);
CREATE POLICY "resources_select_all" ON public.resources
  FOR SELECT USING (true);
CREATE POLICY "resource_files_select_all" ON public.resource_files
  FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE: admin staff only
CREATE POLICY "resource_categories_admin_insert" ON public.resource_categories
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_staff());
CREATE POLICY "resource_categories_admin_update" ON public.resource_categories
  FOR UPDATE TO authenticated USING (public.is_admin_staff()) WITH CHECK (public.is_admin_staff());
CREATE POLICY "resource_categories_admin_delete" ON public.resource_categories
  FOR DELETE TO authenticated USING (public.is_admin_staff());

CREATE POLICY "resources_admin_insert" ON public.resources
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_staff());
CREATE POLICY "resources_admin_update" ON public.resources
  FOR UPDATE TO authenticated USING (public.is_admin_staff()) WITH CHECK (public.is_admin_staff());
CREATE POLICY "resources_admin_delete" ON public.resources
  FOR DELETE TO authenticated USING (public.is_admin_staff());

CREATE POLICY "resource_files_admin_insert" ON public.resource_files
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_staff());
CREATE POLICY "resource_files_admin_update" ON public.resource_files
  FOR UPDATE TO authenticated USING (public.is_admin_staff()) WITH CHECK (public.is_admin_staff());
CREATE POLICY "resource_files_admin_delete" ON public.resource_files
  FOR DELETE TO authenticated USING (public.is_admin_staff());

-- ─────────────────────────────────────────────────────────
-- Seed the 5 categories
-- ─────────────────────────────────────────────────────────
INSERT INTO public.resource_categories (name, slug, color, sort_order) VALUES
  ('Sales',     'sales',     '#4ADE80', 1),
  ('Marketing', 'marketing', '#E8C547', 2),
  ('Systems',   'systems',   '#60A5FA', 3),
  ('HR',        'hr',        '#F472B6', 4),
  ('Strategy',  'strategy',  '#A78BFA', 5);
;

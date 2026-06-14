-- Resources library: let the content/marketing team manage resources, not just
-- admins. Feedback (Cam): "Can we get a content category on resources. I have
-- some ready for upload" — but Resources writes were RLS-locked to is_admin_staff(),
-- and the Resources tab was admin-only, so the content team couldn't upload at all.
--
-- This is ADDITIVE (per core-data guardrails): existing admin policies stay,
-- DELETE stays admin-only. We only broaden INSERT/UPDATE (and storage uploads)
-- to a new is_resource_editor() set = admin + marketing roles.
--
-- NOTE: fc-core-srvc review could not run this session (external repo out of
-- scope). Change is additive + reversible; revisit against core when reachable.

-- Who may edit the global Resources library: admins + the content/marketing team.
CREATE OR REPLACE FUNCTION public.is_resource_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.user_id = auth.uid()
      AND s.role IN ('admin', 'marketing_manager', 'marketing_executor')
  );
$function$;

-- resources
CREATE POLICY "resources_editor_insert" ON public.resources
  FOR INSERT TO authenticated
  WITH CHECK (is_resource_editor());

CREATE POLICY "resources_editor_update" ON public.resources
  FOR UPDATE TO authenticated
  USING (is_resource_editor())
  WITH CHECK (is_resource_editor());

-- resource_files
CREATE POLICY "resource_files_editor_insert" ON public.resource_files
  FOR INSERT TO authenticated
  WITH CHECK (is_resource_editor());

CREATE POLICY "resource_files_editor_update" ON public.resource_files
  FOR UPDATE TO authenticated
  USING (is_resource_editor())
  WITH CHECK (is_resource_editor());

-- resource_categories
CREATE POLICY "resource_categories_editor_insert" ON public.resource_categories
  FOR INSERT TO authenticated
  WITH CHECK (is_resource_editor());

CREATE POLICY "resource_categories_editor_update" ON public.resource_categories
  FOR UPDATE TO authenticated
  USING (is_resource_editor())
  WITH CHECK (is_resource_editor());

-- Storage: uploads to the public `resources` bucket. Additive insert/update for
-- editors (reads are already public; DELETE stays whatever it is today).
CREATE POLICY "resources_bucket_editor_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resources' AND is_resource_editor());

CREATE POLICY "resources_bucket_editor_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'resources' AND is_resource_editor())
  WITH CHECK (bucket_id = 'resources' AND is_resource_editor());

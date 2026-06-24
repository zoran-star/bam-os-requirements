-- Gate resources behind login.
-- Before: `resources` bucket was public + table/storage SELECT allowed anon,
-- so any file URL opened for anyone. After: bucket is private and both the
-- files and the metadata are readable only by AUTHENTICATED users (clients +
-- staff). The portals serve files via short-lived signed URLs.
-- Idempotent: safe to re-run.

-- 1. Bucket -> private (signed URLs only)
UPDATE storage.buckets SET public = false WHERE id = 'resources';

-- 2. Storage read: authenticated only (was: anyone)
DROP POLICY IF EXISTS "resources_storage_select_all" ON storage.objects;
DROP POLICY IF EXISTS "resources_storage_select_authed" ON storage.objects;
CREATE POLICY "resources_storage_select_authed"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resources');

-- 3. Table metadata read: authenticated only (was: USING (true) = anon + authed)
DROP POLICY IF EXISTS "resources_select_all" ON public.resources;
DROP POLICY IF EXISTS "resources_select_authed" ON public.resources;
CREATE POLICY "resources_select_authed"
  ON public.resources FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "resource_files_select_all" ON public.resource_files;
DROP POLICY IF EXISTS "resource_files_select_authed" ON public.resource_files;
CREATE POLICY "resource_files_select_authed"
  ON public.resource_files FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "resource_categories_select_all" ON public.resource_categories;
DROP POLICY IF EXISTS "resource_categories_select_authed" ON public.resource_categories;
CREATE POLICY "resource_categories_select_authed"
  ON public.resource_categories FOR SELECT TO authenticated USING (true);

-- 4. Decorative inline images used INSIDE an authored resource page (content
-- blocks) are not the gated deliverable - they must render for everyone via a
-- stable public URL. Keep them in a separate PUBLIC bucket so the private
-- `resources` bucket holds only the gated file attachments.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('resource-block-images', 'resource-block-images', true, 26214400)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "rbi_select_all" ON storage.objects;
CREATE POLICY "rbi_select_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'resource-block-images');

DROP POLICY IF EXISTS "rbi_editor_insert" ON storage.objects;
CREATE POLICY "rbi_editor_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resource-block-images' AND public.is_resource_editor());

DROP POLICY IF EXISTS "rbi_editor_update" ON storage.objects;
CREATE POLICY "rbi_editor_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resource-block-images' AND public.is_resource_editor())
  WITH CHECK (bucket_id = 'resource-block-images' AND public.is_resource_editor());

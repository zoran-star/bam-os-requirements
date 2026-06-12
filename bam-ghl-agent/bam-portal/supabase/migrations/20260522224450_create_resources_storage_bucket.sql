
-- Create public storage bucket for resource files (matches ticket-files pattern).
-- 500 MB file size limit, no MIME restriction (admin uploads only).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('resources', 'resources', true, 524288000)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- Storage policies: anyone can read; only admin staff can write
CREATE POLICY "resources_storage_select_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'resources');

CREATE POLICY "resources_storage_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resources' AND public.is_admin_staff());

CREATE POLICY "resources_storage_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resources' AND public.is_admin_staff())
  WITH CHECK (bucket_id = 'resources' AND public.is_admin_staff());

CREATE POLICY "resources_storage_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resources' AND public.is_admin_staff());
;

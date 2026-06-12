
-- Storage bucket for offer files (agreements, assets, onboarding messaging attachments)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('offers', 'offers', true, 524288000)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- SELECT: anyone (public bucket, paths are by-client)
CREATE POLICY "offers_storage_select_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'offers');

-- INSERT: client_users for their client_id OR staff
CREATE POLICY "offers_storage_client_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'offers'
    AND (
      (split_part(name, '/', 1))::uuid IN (SELECT my_client_ids())
      OR is_staff()
    )
  );

-- UPDATE: same
CREATE POLICY "offers_storage_client_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'offers'
    AND (
      (split_part(name, '/', 1))::uuid IN (SELECT my_client_ids())
      OR is_staff()
    )
  )
  WITH CHECK (
    bucket_id = 'offers'
    AND (
      (split_part(name, '/', 1))::uuid IN (SELECT my_client_ids())
      OR is_staff()
    )
  );

-- DELETE: same
CREATE POLICY "offers_storage_client_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'offers'
    AND (
      (split_part(name, '/', 1))::uuid IN (SELECT my_client_ids())
      OR is_staff()
    )
  );
;

-- Member avatars: column + public storage bucket + RLS

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-avatars',
  'member-avatars',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "member_avatars_public_read" ON storage.objects;
CREATE POLICY "member_avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'member-avatars');

DROP POLICY IF EXISTS "member_avatars_auth_insert" ON storage.objects;
CREATE POLICY "member_avatars_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'member-avatars');

DROP POLICY IF EXISTS "member_avatars_auth_update" ON storage.objects;
CREATE POLICY "member_avatars_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'member-avatars')
  WITH CHECK (bucket_id = 'member-avatars');

DROP POLICY IF EXISTS "member_avatars_auth_delete" ON storage.objects;
CREATE POLICY "member_avatars_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'member-avatars');;

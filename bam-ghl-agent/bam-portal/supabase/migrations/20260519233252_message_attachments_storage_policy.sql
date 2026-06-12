-- Allow any authenticated user to read message attachments (the URL
-- is already public, this just makes signed-URL reads cheap).
DROP POLICY IF EXISTS "Anyone can read message attachments" ON storage.objects;
CREATE POLICY "Anyone can read message attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'message-attachments');

-- Allow any authenticated user to upload to message-attachments.
-- Folder structure enforced by application code:
--   message-attachments/{conversation_id}/{message_id_or_uuid}/{filename}
-- We don't enforce auth_user_id in the path because clients + staff
-- can both upload to the same conversation; backend validates author
-- on the message insert.
DROP POLICY IF EXISTS "Authed users can upload message attachments" ON storage.objects;
CREATE POLICY "Authed users can upload message attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND auth.role() = 'authenticated'
  );;

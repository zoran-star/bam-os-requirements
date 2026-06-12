-- Extend portal_feedback to support file attachments + a clearer "where it
-- came from" marker. Existing staff-portal text feedback keeps working unchanged.
ALTER TABLE portal_feedback
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS submitter_email text,
  ADD COLUMN IF NOT EXISTS portal text NOT NULL DEFAULT 'staff'
    CHECK (portal IN ('staff', 'client'));

CREATE INDEX IF NOT EXISTS portal_feedback_portal_created_at_idx
  ON portal_feedback(portal, created_at DESC);;

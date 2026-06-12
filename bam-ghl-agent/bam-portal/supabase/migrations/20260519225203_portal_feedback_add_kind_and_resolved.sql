ALTER TABLE portal_feedback
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES staff(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portal_feedback_kind_check'
  ) THEN
    ALTER TABLE portal_feedback
      ADD CONSTRAINT portal_feedback_kind_check CHECK (kind IN ('bug', 'feature'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS portal_feedback_resolved_at_idx
  ON portal_feedback (resolved_at NULLS FIRST, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_feedback_kind_idx
  ON portal_feedback (kind);;

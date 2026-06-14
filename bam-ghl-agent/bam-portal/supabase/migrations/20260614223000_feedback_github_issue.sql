-- Feedback → Action, Phase 2/3: track the GitHub issue spun from a feedback
-- item so we don't double-create (manual "Build spec" button + the digest's
-- auto-spec of safe items). Additive, nullable.
ALTER TABLE public.portal_feedback
  ADD COLUMN IF NOT EXISTS github_issue_url text,
  ADD COLUMN IF NOT EXISTS spec_created_at timestamptz;

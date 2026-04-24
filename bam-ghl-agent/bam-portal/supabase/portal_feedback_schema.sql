-- Portal Feedback Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS portal_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author TEXT NOT NULL DEFAULT 'Mike',
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('text', 'voice')) DEFAULT 'text',
  page TEXT DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'done')) DEFAULT 'pending',
  slack_ts TEXT DEFAULT '',
  slack_channel TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_feedback_status ON portal_feedback(status);
CREATE INDEX IF NOT EXISTS idx_portal_feedback_created ON portal_feedback(created_at DESC);

ALTER TABLE portal_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON portal_feedback FOR ALL TO authenticated USING (true) WITH CHECK (true);

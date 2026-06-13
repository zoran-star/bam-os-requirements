CREATE TABLE public.portal_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  source text NOT NULL DEFAULT 'text'::text,
  page text DEFAULT ''::text,
  status text NOT NULL DEFAULT 'pending'::text,
  slack_ts text DEFAULT ''::text,
  slack_channel text DEFAULT ''::text,
  notes text DEFAULT ''::text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  author_id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT portal_feedback_source_check CHECK (source IN ('text', 'voice')),
  CONSTRAINT portal_feedback_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'done'))
);

CREATE INDEX idx_portal_feedback_status ON public.portal_feedback (status);
CREATE INDEX idx_portal_feedback_created ON public.portal_feedback (created_at DESC);

ALTER TABLE public.portal_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated"
  ON public.portal_feedback
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

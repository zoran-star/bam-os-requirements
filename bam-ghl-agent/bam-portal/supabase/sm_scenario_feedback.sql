-- Scenario quality feedback table — lets admins/lead SMs rate and comment on question quality
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sm_scenario_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES sm_scenarios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'okay', 'bad')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scenario_id, user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_scenario_feedback_scenario ON sm_scenario_feedback(scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenario_feedback_user ON sm_scenario_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_scenario_feedback_rating ON sm_scenario_feedback(rating);

-- RLS policies
ALTER TABLE sm_scenario_feedback ENABLE ROW LEVEL SECURITY;

-- Admins and lead SMs can do everything
CREATE POLICY "Admins can manage all feedback" ON sm_scenario_feedback
  FOR ALL USING (
    EXISTS (SELECT 1 FROM sm_user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'lead_sm'))
  );

-- Regular SMs can read their own feedback
CREATE POLICY "Users can read own feedback" ON sm_scenario_feedback
  FOR SELECT USING (user_id = auth.uid());

-- Regular SMs can insert their own feedback
CREATE POLICY "Users can insert own feedback" ON sm_scenario_feedback
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Regular SMs can update their own feedback
CREATE POLICY "Users can update own feedback" ON sm_scenario_feedback
  FOR UPDATE USING (user_id = auth.uid());

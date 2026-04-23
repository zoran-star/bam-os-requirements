-- SM Training System Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- TABLES
-- ============================================

-- Training units (curriculum modules)
CREATE TABLE sm_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  unlock_after UUID REFERENCES sm_units(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Scenario bank
CREATE TABLE sm_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES sm_units(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('quick_fire', 'deep_situation')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context TEXT,
  visual_type TEXT CHECK (visual_type IN ('none', 'chart', 'table', 'dashboard_mock', 'email', 'text_thread', 'pnl')),
  visual_data JSONB,
  ideal_response TEXT,
  scoring_rubric JSONB,
  follow_ups JSONB,
  character_prompt TEXT,
  source_transcript_id UUID,
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Transcript corpus
CREATE TABLE sm_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client_type TEXT,
  raw_text TEXT NOT NULL,
  summary TEXT,
  tags TEXT[],
  key_problems JSONB,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Training sessions (one per SM per day)
CREATE TABLE sm_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  quick_fire_target INTEGER DEFAULT 10,
  deep_situation_target INTEGER DEFAULT 3,
  quick_fire_completed INTEGER DEFAULT 0,
  deep_situation_completed INTEGER DEFAULT 0,
  is_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Individual responses
CREATE TABLE sm_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sm_sessions(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES sm_scenarios(id),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  response_audio_url TEXT,
  response_duration_seconds INTEGER,
  ai_score INTEGER CHECK (ai_score BETWEEN 1 AND 10),
  ai_feedback TEXT,
  ai_tldr TEXT,
  ai_ideal_comparison TEXT,
  ai_strengths TEXT[],
  ai_gaps TEXT[],
  mike_score INTEGER CHECK (mike_score BETWEEN 1 AND 5),
  mike_notes TEXT,
  mike_reviewed_at TIMESTAMPTZ,
  conversation_history JSONB,
  type TEXT NOT NULL CHECK (type IN ('quick_fire', 'deep_situation')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Progress tracking (per user per unit)
CREATE TABLE sm_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES sm_units(id) ON DELETE CASCADE,
  ai_competency_score NUMERIC(5,2) DEFAULT 0,
  mike_competency_score NUMERIC(5,2),
  scenarios_completed INTEGER DEFAULT 0,
  scenarios_total INTEGER DEFAULT 0,
  status TEXT DEFAULT 'locked' CHECK (status IN ('locked', 'in_progress', 'completed', 'certified')),
  certified_at TIMESTAMPTZ,
  certified_by UUID REFERENCES auth.users(id),
  weak_tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, unit_id)
);

-- Daily situation queue
CREATE TABLE sm_daily_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sm_sessions(id),
  scenario_id UUID REFERENCES sm_scenarios(id),
  type TEXT NOT NULL CHECK (type IN ('quick_fire', 'deep_situation')),
  queue_order INTEGER NOT NULL,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User roles for the training system
CREATE TABLE sm_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('trainee', 'lead_sm', 'admin')),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE sm_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_daily_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_user_roles ENABLE ROW LEVEL SECURITY;

-- Helper function: get user's training role
CREATE OR REPLACE FUNCTION get_sm_role(uid UUID)
RETURNS TEXT AS $$
  SELECT role FROM sm_user_roles WHERE user_id = uid LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- sm_units: readable by all authenticated
CREATE POLICY "Units readable by authenticated" ON sm_units
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Units manageable by admin" ON sm_units
  FOR ALL TO authenticated USING (get_sm_role(auth.uid()) = 'admin');

-- sm_scenarios: readable by all authenticated
CREATE POLICY "Scenarios readable by authenticated" ON sm_scenarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Scenarios manageable by admin/lead" ON sm_scenarios
  FOR ALL TO authenticated USING (get_sm_role(auth.uid()) IN ('admin', 'lead_sm'));

-- sm_transcripts: only lead_sm and admin
CREATE POLICY "Transcripts for lead/admin" ON sm_transcripts
  FOR SELECT TO authenticated USING (get_sm_role(auth.uid()) IN ('admin', 'lead_sm'));
CREATE POLICY "Transcripts manageable by admin/lead" ON sm_transcripts
  FOR ALL TO authenticated USING (get_sm_role(auth.uid()) IN ('admin', 'lead_sm'));

-- sm_sessions: trainees see own, lead/admin see all
CREATE POLICY "Sessions own read" ON sm_sessions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );
CREATE POLICY "Sessions own insert" ON sm_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Sessions own update" ON sm_sessions
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );

-- sm_responses: trainees see own, lead/admin see all, lead can update scores
CREATE POLICY "Responses own read" ON sm_responses
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );
CREATE POLICY "Responses own insert" ON sm_responses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Responses update by lead/admin" ON sm_responses
  FOR UPDATE TO authenticated USING (get_sm_role(auth.uid()) IN ('admin', 'lead_sm'));

-- sm_progress: trainees see own, lead/admin see all
CREATE POLICY "Progress own read" ON sm_progress
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );
CREATE POLICY "Progress own insert" ON sm_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Progress update" ON sm_progress
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );

-- sm_daily_queue: trainees see own
CREATE POLICY "Queue own read" ON sm_daily_queue
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );
CREATE POLICY "Queue insert" ON sm_daily_queue
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );
CREATE POLICY "Queue update" ON sm_daily_queue
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid() OR get_sm_role(auth.uid()) IN ('admin', 'lead_sm')
  );

-- sm_user_roles: readable by all authenticated, manageable by admin
CREATE POLICY "Roles readable" ON sm_user_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Roles manageable by admin" ON sm_user_roles
  FOR ALL TO authenticated USING (get_sm_role(auth.uid()) = 'admin');

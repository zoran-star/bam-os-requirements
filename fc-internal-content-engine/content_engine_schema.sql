-- Content Engine Tables for FullControl
-- Run this in Supabase SQL Editor

-- Themes (top-level pillars / messaging categories)
CREATE TABLE IF NOT EXISTS content_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '',
  mode TEXT NOT NULL CHECK (mode IN ('paid', 'organic', 'both')) DEFAULT 'paid',
  creator TEXT NOT NULL DEFAULT 'Coleman',
  phase SMALLINT DEFAULT 0 CHECK (phase IN (0, 1, 2)),
  sort_order INT DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Creatives (angles / concepts within themes)
CREATE TABLE IF NOT EXISTS content_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id UUID NOT NULL REFERENCES content_themes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hook TEXT DEFAULT '',
  cta TEXT DEFAULT '',
  tone TEXT DEFAULT 'Conversational',
  video_style TEXT DEFAULT 'talking_head',
  format TEXT DEFAULT '',
  psych_lever TEXT DEFAULT '',
  persona TEXT DEFAULT '',
  phase SMALLINT DEFAULT 0 CHECK (phase IN (0, 1, 2)),
  mode TEXT CHECK (mode IN ('paid', 'organic')) DEFAULT 'paid',
  creator TEXT DEFAULT 'Coleman',
  notes TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Scripts (AI-generated, versioned per creative)
CREATE TABLE IF NOT EXISTS content_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES content_creatives(id) ON DELETE CASCADE,
  version INT DEFAULT 1,
  body TEXT NOT NULL,
  prompt_snapshot JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'recorded', 'published')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Feedback (voice or text, per script)
CREATE TABLE IF NOT EXISTS content_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL REFERENCES content_scripts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('voice', 'text')) DEFAULT 'text',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_creatives_theme ON content_creatives(theme_id);
CREATE INDEX IF NOT EXISTS idx_content_scripts_creative ON content_scripts(creative_id);
CREATE INDEX IF NOT EXISTS idx_content_feedback_script ON content_feedback(script_id);
CREATE INDEX IF NOT EXISTS idx_content_themes_mode ON content_themes(mode);
CREATE INDEX IF NOT EXISTS idx_content_themes_creator ON content_themes(creator);
CREATE INDEX IF NOT EXISTS idx_content_creatives_psych ON content_creatives(psych_lever);
CREATE INDEX IF NOT EXISTS idx_content_creatives_format ON content_creatives(format);

-- RLS: Enable and allow all for anon users (internal tool, no auth)
ALTER TABLE content_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON content_themes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON content_creatives FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON content_scripts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON content_feedback FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON content_themes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON content_creatives FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON content_scripts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON content_feedback FOR ALL TO authenticated USING (true) WITH CHECK (true);

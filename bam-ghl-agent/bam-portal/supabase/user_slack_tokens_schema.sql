-- Per-user Slack OAuth tokens
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_slack_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  slack_user_id TEXT,
  slack_team_id TEXT,
  slack_team_name TEXT,
  scopes TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_slack_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read their own row (for status checks from frontend)
CREATE POLICY "Users can read own token" ON user_slack_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Users can delete their own row (disconnect)
CREATE POLICY "Users can delete own token" ON user_slack_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Users can insert their own token (OAuth callback)
CREATE POLICY "Users can insert own token" ON user_slack_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own token (re-connect)
CREATE POLICY "Users can update own token" ON user_slack_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

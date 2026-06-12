-- agent_sessions — Claude Code session transcripts captured by /showtime → /byebye skills
-- Stored for Zoran's review of how the team (Cam, Cole, Mike, Rosano, etc.) uses Claude.

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email          text NOT NULL,
  user_display_name   text,
  project_path        text,
  session_id          text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  message_count       int NOT NULL DEFAULT 0,
  transcript          jsonb NOT NULL DEFAULT '[]'::jsonb,
  technical_summary   text,
  visual_summary      text,
  status              text NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress', 'completed', 'failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_email
  ON public.agent_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started_at
  ON public.agent_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON public.agent_sessions(status);

-- RLS — only zoran@byanymeansbball.com can read; only service role can write
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_sessions_zoran_read"
  ON public.agent_sessions FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'email' = 'zoran@byanymeansbball.com');

-- (No INSERT/UPDATE policies — service role bypasses RLS, anon/authed cannot write)

COMMENT ON TABLE public.agent_sessions IS
  'Claude Code session transcripts captured via /showtime and /byebye skills. Read-restricted to Zoran.';;

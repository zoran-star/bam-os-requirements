
-- ─────────────────────────────────────────────────────────────────
-- Post a Slack confirmation to the client's channel when a new
-- ticket is created. Fires on AFTER INSERT regardless of source
-- (client direct insert, staff API POST). Fire-and-forget via pg_net.
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Slack bot token stored in a config row (lets us rotate without
-- redeploying the trigger). Locked down via RLS so only service role
-- can read.
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- No SELECT/UPDATE policies — only service role bypass works.

-- Token value REDACTED in this fetched copy (it was inlined when this
-- migration was applied via MCP; the live value sits in prod app_secrets).
-- This file is history bookkeeping only — db push never replays it.
INSERT INTO public.app_secrets (key, value) VALUES
  ('slack_bot_token', '<REDACTED>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE OR REPLACE FUNCTION public.notify_slack_on_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_channel        text;
  v_business       text;
  v_token          text;
  v_title          text;
  v_type_label     text;
  v_priority_pre   text;
  v_message        text;
BEGIN
  -- Look up the client's Slack channel + business name
  SELECT slack_channel_id, COALESCE(business_name, 'Client')
    INTO v_channel, v_business
  FROM public.clients
  WHERE id = NEW.client_id;

  IF v_channel IS NULL THEN
    RETURN NEW; -- No channel configured, skip silently
  END IF;

  SELECT value INTO v_token FROM public.app_secrets WHERE key = 'slack_bot_token';
  IF v_token IS NULL THEN
    RETURN NEW; -- No token, skip
  END IF;

  -- Compose the message
  v_title := COALESCE(NEW.menu_item, NEW.fields->>'title', '(no title)');
  v_type_label := CASE
    WHEN NEW.type = 'error'  THEN '🛠 Error report'
    WHEN NEW.type = 'change' THEN '🔧 Change request'
    WHEN NEW.type = 'build'  THEN '🏗 Build request'
    ELSE '📥 Ticket'
  END;
  v_priority_pre := CASE
    WHEN NEW.priority IN ('urgent','red_alert') THEN '🚨 *URGENT* — '
    ELSE ''
  END;

  v_message := v_priority_pre || v_type_label || ' submitted: *' || v_title || '*' || E'\n' ||
               '_The BAM team has been notified and will follow up shortly._';

  -- Fire-and-forget via pg_net (returns a request id; we don't care about the response)
  PERFORM net.http_post(
    url := 'https://slack.com/api/chat.postMessage',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type',  'application/json; charset=utf-8'
    ),
    body := jsonb_build_object(
      'channel', v_channel,
      'text',    v_message,
      'unfurl_links', false
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let Slack failures block ticket creation
  RAISE WARNING 'notify_slack_on_new_ticket failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_notify_slack_on_insert ON public.tickets;
CREATE TRIGGER tickets_notify_slack_on_insert
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_new_ticket();
;

-- ─────────────────────────────────────────────────────────────────
-- Slack replacement: in-portal messaging
-- ─────────────────────────────────────────────────────────────────
-- One conversation per client for now (kind='general'). Schema is
-- extensible if we ever add more conversation kinds. Each message is
-- its own row (not jsonb) so we get Supabase Realtime row-level
-- subscriptions, efficient pagination, and clean edit/delete tracking.

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general')),
  -- Denormalized for cheap inbox sorting + previews (updated by trigger
  -- below on every new message insert)
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind)
);

CREATE INDEX IF NOT EXISTS conversations_client_id_idx
  ON public.conversations(client_id);
CREATE INDEX IF NOT EXISTS conversations_last_message_at_idx
  ON public.conversations(last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  -- Author: exactly one of staff_id or client_id is set. auth_user_id
  -- is always set (the underlying supabase auth user) so we can verify
  -- the writer at send time without resolving staff/client lookup.
  author_staff_id uuid REFERENCES public.staff(id),
  author_client_id uuid REFERENCES public.clients(id),
  author_auth_user_id uuid NOT NULL,
  body text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{url, name, size, mime}]
  mentioned_staff_ids uuid[] NOT NULL DEFAULT '{}',
  -- Edit/delete tracking (soft delete only; never hard-delete history)
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (author_staff_id IS NOT NULL AND author_client_id IS NULL)
    OR (author_staff_id IS NULL AND author_client_id IS NOT NULL)
  ),
  CHECK (body IS NOT NULL OR jsonb_array_length(files) > 0)  -- must have text or file
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_created_at_idx
  ON public.conversation_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_created_at_idx
  ON public.conversation_messages(created_at DESC);

-- Per-user read tracking. We don't compute unread on every render —
-- instead the client/staff updates this row on conversation open,
-- and the inbox derives badge count from messages WHERE created_at > last_read_at.
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS conversation_reads_auth_user_id_idx
  ON public.conversation_reads(auth_user_id);

-- ─── Triggers ──────────────────────────────────────────────────────

-- When a new message is inserted, update the parent conversation's
-- last_message_at + preview so inbox sorting + list view stay fresh
-- without a separate query per row.
CREATE OR REPLACE FUNCTION public.update_conversation_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(COALESCE(NEW.body, ''), 140),
    updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversation_messages_update_parent ON public.conversation_messages;
CREATE TRIGGER conversation_messages_update_parent
AFTER INSERT ON public.conversation_messages
FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_new_message();

-- When a new client is created, auto-create their general conversation.
-- Idempotent via ON CONFLICT (client_id, kind) — re-runs are safe.
CREATE OR REPLACE FUNCTION public.create_conversation_for_new_client()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.conversations (client_id, kind)
  VALUES (NEW.id, 'general')
  ON CONFLICT (client_id, kind) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_create_conversation ON public.clients;
CREATE TRIGGER clients_create_conversation
AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.create_conversation_for_new_client();

-- ─── Row-Level Security ────────────────────────────────────────────
-- Writes go through the backend with service_role (bypasses RLS).
-- These policies cover READ paths used by the frontend's Supabase JS
-- client (which uses anon key + user JWT for Realtime + direct selects).

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

-- Clients can read conversations linked to their client row
DROP POLICY IF EXISTS "clients_read_own_conversations" ON public.conversations;
CREATE POLICY "clients_read_own_conversations" ON public.conversations
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM public.clients WHERE auth_user_id = auth.uid()
    )
  );

-- Any staff member can read all conversations (per design decision: open team access)
DROP POLICY IF EXISTS "staff_read_all_conversations" ON public.conversations;
CREATE POLICY "staff_read_all_conversations" ON public.conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.staff WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "clients_read_own_messages" ON public.conversation_messages;
CREATE POLICY "clients_read_own_messages" ON public.conversation_messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT c.id FROM public.conversations c
      JOIN public.clients cl ON cl.id = c.client_id
      WHERE cl.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_read_all_messages" ON public.conversation_messages;
CREATE POLICY "staff_read_all_messages" ON public.conversation_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.staff WHERE user_id = auth.uid())
  );

-- conversation_reads: a user can only read/write their own row
DROP POLICY IF EXISTS "users_read_own_reads" ON public.conversation_reads;
CREATE POLICY "users_read_own_reads" ON public.conversation_reads
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "users_upsert_own_reads" ON public.conversation_reads;
CREATE POLICY "users_upsert_own_reads" ON public.conversation_reads
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "users_update_own_reads" ON public.conversation_reads;
CREATE POLICY "users_update_own_reads" ON public.conversation_reads
  FOR UPDATE USING (auth_user_id = auth.uid());

-- ─── Enable Realtime ───────────────────────────────────────────────
-- Without this, Supabase Realtime won't deliver row-level events for
-- these tables. (Safe to re-run; ALTER PUBLICATION is idempotent if
-- the table is already in the publication via DROP first.)
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;;

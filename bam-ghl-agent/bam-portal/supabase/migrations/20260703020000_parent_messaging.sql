-- Parent messaging schema migration (Phase 1).
-- Source of truth:
-- /Users/lukamircetic/Documents/full-control/fc-mobile/docs/parent-messaging-design-proposal.md
--
-- RLS: every table is enabled with zero policies. Parent and staff access goes
-- through service-role APIs only.

-- -- 1. customer_message_threads ------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_message_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    customer_profile_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'GENERAL'
        CHECK (kind IN ('GENERAL')),
    status text NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'CLOSED')),
    assigned_auth_user_id uuid,
    subject_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
    last_message_at timestamptz,
    last_message_preview text,
    last_message_author_type text
        CHECK (last_message_author_type IS NULL OR last_message_author_type IN ('PARENT', 'STAFF', 'SYSTEM')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_customer_message_threads_tenant_profile_kind
        UNIQUE (tenant_id, customer_profile_id, kind),
    CONSTRAINT uq_customer_message_threads_id_tenant
        UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS ix_customer_message_threads_tenant_last_message
    ON public.customer_message_threads USING btree (tenant_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS ix_customer_message_threads_profile_tenant
    ON public.customer_message_threads USING btree (customer_profile_id, tenant_id);

CREATE INDEX IF NOT EXISTS ix_customer_message_threads_assigned_status_last
    ON public.customer_message_threads USING btree (tenant_id, assigned_auth_user_id, status, last_message_at DESC);

-- -- 2. customer_thread_messages ------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_thread_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES public.customer_message_threads(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    author_type text NOT NULL CHECK (author_type IN ('PARENT', 'STAFF', 'SYSTEM')),
    author_customer_profile_id uuid REFERENCES public.customer_profiles(id) ON DELETE SET NULL,
    author_auth_user_id uuid,
    author_display_name text,
    message_type text NOT NULL DEFAULT 'TEXT'
        CHECK (message_type IN ('TEXT', 'ANNOUNCEMENT', 'SYSTEM')),
    body text,
    client_message_id text,
    edited_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT customer_thread_messages_author_check CHECK (
        (author_type = 'PARENT' AND author_customer_profile_id IS NOT NULL AND author_auth_user_id IS NOT NULL)
        OR (author_type = 'STAFF' AND author_customer_profile_id IS NULL AND author_auth_user_id IS NOT NULL)
        OR (author_type = 'SYSTEM' AND author_customer_profile_id IS NULL AND author_auth_user_id IS NULL)
    ),
    CONSTRAINT customer_thread_messages_body_check CHECK (
        deleted_at IS NOT NULL
        OR nullif(btrim(coalesce(body, '')), '') IS NOT NULL
    ),
    CONSTRAINT customer_thread_messages_thread_tenant_fk
        FOREIGN KEY (thread_id, tenant_id)
        REFERENCES public.customer_message_threads(id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_thread_messages_client_message
    ON public.customer_thread_messages USING btree (thread_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_customer_thread_messages_thread_created
    ON public.customer_thread_messages USING btree (thread_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_customer_thread_messages_tenant_created
    ON public.customer_thread_messages USING btree (tenant_id, created_at DESC);

-- -- 3. customer_thread_reads ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_thread_reads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES public.customer_message_threads(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    reader_type text NOT NULL CHECK (reader_type IN ('PARENT', 'STAFF')),
    customer_profile_id uuid REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    auth_user_id uuid NOT NULL,
    last_read_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_thread_reads_reader_check CHECK (
        (reader_type = 'PARENT' AND customer_profile_id IS NOT NULL)
        OR (reader_type = 'STAFF' AND customer_profile_id IS NULL)
    ),
    CONSTRAINT uq_customer_thread_reads_thread_auth_user
        UNIQUE (thread_id, auth_user_id)
);

-- -- 4. thread summary trigger --------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_thread_messages_apply_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE public.customer_message_threads
    SET last_message_at = NEW.created_at,
        last_message_preview = CASE
            WHEN NEW.body IS NULL THEN last_message_preview
            ELSE left(NEW.body, 140)
        END,
        last_message_author_type = NEW.author_type,
        updated_at = now()
    WHERE id = NEW.thread_id
      AND tenant_id = NEW.tenant_id;

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'customer_thread_messages_apply_summary'
          AND tgrelid = 'public.customer_thread_messages'::regclass
    ) THEN
        CREATE TRIGGER customer_thread_messages_apply_summary
            AFTER INSERT ON public.customer_thread_messages
            FOR EACH ROW EXECUTE FUNCTION public.customer_thread_messages_apply_summary();
    END IF;
END;
$$;

-- -- 5. updated_at triggers ------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'customer_message_threads_updated_at'
          AND tgrelid = 'public.customer_message_threads'::regclass
    ) THEN
        CREATE TRIGGER customer_message_threads_updated_at
            BEFORE UPDATE ON public.customer_message_threads
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'customer_thread_messages_updated_at'
          AND tgrelid = 'public.customer_thread_messages'::regclass
    ) THEN
        CREATE TRIGGER customer_thread_messages_updated_at
            BEFORE UPDATE ON public.customer_thread_messages
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'customer_thread_reads_updated_at'
          AND tgrelid = 'public.customer_thread_reads'::regclass
    ) THEN
        CREATE TRIGGER customer_thread_reads_updated_at
            BEFORE UPDATE ON public.customer_thread_reads
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

-- -- 6. send RPC -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_send_thread_message(
    p_tenant_id uuid,
    p_customer_profile_id uuid,
    p_thread_id uuid,
    p_author_type text,
    p_author_auth_user_id uuid,
    p_author_display_name text,
    p_body text,
    p_client_message_id text,
    p_message_type text DEFAULT 'TEXT'
)
RETURNS TABLE (
    message jsonb,
    thread jsonb
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    normalized_author_type text;
    normalized_message_type text;
    normalized_body text;
    normalized_display_name text;
    normalized_client_message_id text;
    thread_row public.customer_message_threads%ROWTYPE;
    message_row public.customer_thread_messages%ROWTYPE;
    refreshed_thread_row public.customer_message_threads%ROWTYPE;
    inserted_message boolean;
BEGIN
    normalized_author_type := upper(NULLIF(btrim(p_author_type), ''));
    normalized_message_type := upper(COALESCE(NULLIF(btrim(p_message_type), ''), 'TEXT'));
    normalized_body := NULLIF(btrim(p_body), '');
    normalized_display_name := NULLIF(btrim(p_author_display_name), '');
    normalized_client_message_id := NULLIF(btrim(p_client_message_id), '');

    IF normalized_author_type IS NULL OR normalized_author_type NOT IN ('PARENT', 'STAFF', 'SYSTEM') THEN
        RAISE EXCEPTION 'Invalid message author.';
    END IF;

    IF normalized_message_type NOT IN ('TEXT', 'ANNOUNCEMENT', 'SYSTEM') THEN
        RAISE EXCEPTION 'Invalid message type.';
    END IF;

    IF normalized_body IS NULL THEN
        RAISE EXCEPTION 'Message body is required.';
    END IF;

    IF normalized_author_type = 'PARENT' AND p_customer_profile_id IS NULL THEN
        RAISE EXCEPTION 'Customer profile is required.';
    END IF;

    IF normalized_author_type IN ('PARENT', 'STAFF') AND p_author_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Author auth user is required.';
    END IF;

    IF normalized_author_type = 'SYSTEM' AND p_author_auth_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid system author.';
    END IF;

    IF p_thread_id IS NULL THEN
        IF p_customer_profile_id IS NULL THEN
            RAISE EXCEPTION 'Customer profile is required.';
        END IF;

        INSERT INTO public.customer_message_threads (
            tenant_id,
            customer_profile_id,
            kind
        )
        VALUES (
            p_tenant_id,
            p_customer_profile_id,
            'GENERAL'
        )
        ON CONFLICT (tenant_id, customer_profile_id, kind) DO NOTHING;

        SELECT *
        INTO thread_row
        FROM public.customer_message_threads
        WHERE tenant_id = p_tenant_id
          AND customer_profile_id = p_customer_profile_id
          AND kind = 'GENERAL'
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Thread not found.';
        END IF;
    ELSE
        SELECT *
        INTO thread_row
        FROM public.customer_message_threads
        WHERE id = p_thread_id
          AND tenant_id = p_tenant_id
          AND (
              normalized_author_type <> 'PARENT'
              OR customer_profile_id = p_customer_profile_id
          )
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Thread not found.';
        END IF;
    END IF;

    INSERT INTO public.customer_thread_messages (
        thread_id,
        tenant_id,
        author_type,
        author_customer_profile_id,
        author_auth_user_id,
        author_display_name,
        message_type,
        body,
        client_message_id
    )
    VALUES (
        thread_row.id,
        p_tenant_id,
        normalized_author_type,
        CASE WHEN normalized_author_type = 'PARENT' THEN p_customer_profile_id ELSE NULL END,
        CASE WHEN normalized_author_type IN ('PARENT', 'STAFF') THEN p_author_auth_user_id ELSE NULL END,
        normalized_display_name,
        normalized_message_type,
        normalized_body,
        normalized_client_message_id
    )
    ON CONFLICT (thread_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
    RETURNING * INTO message_row;

    inserted_message := message_row.id IS NOT NULL;

    IF NOT inserted_message THEN
        SELECT *
        INTO message_row
        FROM public.customer_thread_messages
        WHERE thread_id = thread_row.id
          AND client_message_id = normalized_client_message_id
        ORDER BY created_at DESC, id DESC
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Message not found.';
        END IF;
    END IF;

    IF inserted_message AND thread_row.status = 'CLOSED' AND normalized_author_type = 'PARENT' THEN
        UPDATE public.customer_message_threads
        SET status = 'OPEN',
            closed_at = NULL,
            updated_at = now()
        WHERE id = thread_row.id
          AND tenant_id = p_tenant_id;
    END IF;

    IF inserted_message AND normalized_author_type IN ('PARENT', 'STAFF') THEN
        INSERT INTO public.customer_thread_reads (
            thread_id,
            tenant_id,
            reader_type,
            customer_profile_id,
            auth_user_id,
            last_read_at
        )
        VALUES (
            thread_row.id,
            p_tenant_id,
            normalized_author_type,
            CASE WHEN normalized_author_type = 'PARENT' THEN p_customer_profile_id ELSE NULL END,
            p_author_auth_user_id,
            now()
        )
        ON CONFLICT (thread_id, auth_user_id) DO UPDATE
        SET reader_type = EXCLUDED.reader_type,
            customer_profile_id = EXCLUDED.customer_profile_id,
            last_read_at = now(),
            updated_at = now();
    END IF;

    SELECT *
    INTO refreshed_thread_row
    FROM public.customer_message_threads
    WHERE id = thread_row.id
      AND tenant_id = p_tenant_id;

    RETURN QUERY
    SELECT to_jsonb(message_row), to_jsonb(refreshed_thread_row);
END;
$$;

-- -- 7. RLS and grants -----------------------------------------------------

ALTER TABLE public.customer_message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_thread_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_thread_reads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_message_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_thread_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_thread_reads FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.customer_message_threads TO service_role;
GRANT ALL ON TABLE public.customer_thread_messages TO service_role;
GRANT ALL ON TABLE public.customer_thread_reads TO service_role;

REVOKE ALL ON FUNCTION public.customer_thread_messages_apply_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_send_thread_message(uuid, uuid, uuid, text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_thread_messages_apply_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_send_thread_message(uuid, uuid, uuid, text, uuid, text, text, text, text) TO service_role;

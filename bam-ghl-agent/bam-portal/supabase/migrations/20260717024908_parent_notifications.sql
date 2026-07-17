-- Parent notification event, preference, and delivery foundation.
--
-- Push is the only active channel in this phase. SMS is represented so consent
-- and future delivery work do not require a second domain model, but no SMS
-- delivery is created or processed here.
--
-- Parent notification tables are service-role only. The parent app reaches
-- them through authenticated Vercel APIs.

-- 1. Distinguish the existing client-portal APNs registrations from parent
-- Expo registrations without interrupting current client-portal delivery.

ALTER TABLE public.device_tokens
    ADD COLUMN IF NOT EXISTS app_scope text NOT NULL DEFAULT 'CLIENT_PORTAL',
    ADD COLUMN IF NOT EXISTS token_provider text NOT NULL DEFAULT 'APNS',
    ADD COLUMN IF NOT EXISTS app_environment text NOT NULL DEFAULT 'production',
    ADD COLUMN IF NOT EXISTS project_id text,
    ADD COLUMN IF NOT EXISTS installation_id uuid,
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_error text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'device_tokens_app_scope_check'
          AND conrelid = 'public.device_tokens'::regclass
    ) THEN
        ALTER TABLE public.device_tokens
            ADD CONSTRAINT device_tokens_app_scope_check
            CHECK (app_scope IN ('CLIENT_PORTAL', 'PARENT'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'device_tokens_provider_check'
          AND conrelid = 'public.device_tokens'::regclass
    ) THEN
        ALTER TABLE public.device_tokens
            ADD CONSTRAINT device_tokens_provider_check
            CHECK (token_provider IN ('APNS', 'EXPO'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'device_tokens_environment_check'
          AND conrelid = 'public.device_tokens'::regclass
    ) THEN
        ALTER TABLE public.device_tokens
            ADD CONSTRAINT device_tokens_environment_check
            CHECK (app_environment IN ('development', 'staging', 'production'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'device_tokens_scope_provider_check'
          AND conrelid = 'public.device_tokens'::regclass
    ) THEN
        ALTER TABLE public.device_tokens
            ADD CONSTRAINT device_tokens_scope_provider_check
            CHECK (
                (app_scope = 'CLIENT_PORTAL' AND token_provider = 'APNS')
                OR (
                    app_scope = 'PARENT'
                    AND token_provider = 'EXPO'
                    AND project_id IS NOT NULL
                    AND installation_id IS NOT NULL
                )
            );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_device_tokens_parent_active_user
    ON public.device_tokens USING btree (auth_user_id, app_environment)
    WHERE app_scope = 'PARENT'
      AND token_provider = 'EXPO'
      AND disabled_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_device_tokens_parent_installation
    ON public.device_tokens USING btree (auth_user_id, installation_id)
    WHERE app_scope = 'PARENT'
      AND token_provider = 'EXPO';

-- Keep the legacy direct-to-Supabase policies available only for the existing
-- client-portal APNs registration path. Parent Expo registrations are managed
-- exclusively through the service-role parent API.

DROP POLICY IF EXISTS "device_tokens_owner_select" ON public.device_tokens;
DROP POLICY IF EXISTS "device_tokens_owner_insert" ON public.device_tokens;
DROP POLICY IF EXISTS "device_tokens_owner_update" ON public.device_tokens;
DROP POLICY IF EXISTS "device_tokens_owner_delete" ON public.device_tokens;

CREATE POLICY "device_tokens_owner_select" ON public.device_tokens
    FOR SELECT USING (
        auth_user_id = auth.uid()
        AND app_scope = 'CLIENT_PORTAL'
        AND token_provider = 'APNS'
    );

CREATE POLICY "device_tokens_owner_insert" ON public.device_tokens
    FOR INSERT WITH CHECK (
        auth_user_id = auth.uid()
        AND app_scope = 'CLIENT_PORTAL'
        AND token_provider = 'APNS'
    );

CREATE POLICY "device_tokens_owner_update" ON public.device_tokens
    FOR UPDATE USING (
        auth_user_id = auth.uid()
        AND app_scope = 'CLIENT_PORTAL'
        AND token_provider = 'APNS'
    ) WITH CHECK (
        auth_user_id = auth.uid()
        AND app_scope = 'CLIENT_PORTAL'
        AND token_provider = 'APNS'
    );

CREATE POLICY "device_tokens_owner_delete" ON public.device_tokens
    FOR DELETE USING (
        auth_user_id = auth.uid()
        AND app_scope = 'CLIENT_PORTAL'
        AND token_provider = 'APNS'
    );

-- 2. Immutable notification events. Event creation is independent from the
-- decision to deliver on a channel or show a foreground alert.

CREATE TABLE IF NOT EXISTS public.parent_notification_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    customer_profile_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    recipient_auth_user_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN (
        'BOOKING_CONFIRMED',
        'BOOKING_CANCELLED',
        'WAITLIST_JOINED',
        'WAITLIST_LEFT',
        'WAITLIST_PROMOTED',
        'TRIAL_BOOKED',
        'TRIAL_CHANGED',
        'TRIAL_CANCELLED',
        'CLASS_CANCELLED',
        'CLASS_RESCHEDULED',
        'MEMBERSHIP_CHANGE_REQUESTED',
        'MEMBERSHIP_ACTIVATED',
        'MEMBERSHIP_CHANGED',
        'PAYMENT_FAILED',
        'STAFF_MESSAGE_RECEIVED',
        'PARENT_MESSAGE_SENT',
        'SESSION_REMINDER',
        'TRIAL_REMINDER'
    )),
    category text NOT NULL CHECK (category IN (
        'MESSAGES', 'BOOKINGS', 'SCHEDULE', 'MEMBERSHIPS', 'BILLING'
    )),
    event_class text NOT NULL CHECK (event_class IN (
        'ACKNOWLEDGEMENT', 'CONTEXTUAL', 'ATTENTION_REQUIRED'
    )),
    actor_type text NOT NULL CHECK (actor_type IN ('PARENT', 'STAFF', 'SYSTEM', 'PROVIDER')),
    actor_auth_user_id uuid,
    subject_type text NOT NULL CHECK (subject_type IN (
        'MESSAGE', 'BOOKING', 'WAITLIST', 'TRIAL', 'CLASS', 'MEMBERSHIP', 'PAYMENT', 'SESSION'
    )),
    subject_id uuid,
    dedupe_key text NOT NULL UNIQUE,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_parent_notification_events_recipient_created
    ON public.parent_notification_events USING btree (recipient_auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_parent_notification_events_tenant_type_created
    ON public.parent_notification_events USING btree (tenant_id, event_type, created_at DESC);

-- 3. Preferences are account-wide by category and channel. Missing PUSH rows
-- mean enabled; missing SMS rows mean disabled. SMS consent is retained here,
-- but no SMS worker exists in this phase.

CREATE TABLE IF NOT EXISTS public.parent_notification_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_profile_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (category IN (
        'MESSAGES', 'BOOKINGS', 'SCHEDULE', 'MEMBERSHIPS', 'BILLING'
    )),
    channel text NOT NULL CHECK (channel IN ('PUSH', 'SMS')),
    enabled boolean NOT NULL,
    sms_consent_status text CHECK (
        sms_consent_status IS NULL
        OR sms_consent_status IN ('NOT_REQUESTED', 'OPTED_IN', 'OPTED_OUT')
    ),
    sms_consented_at timestamptz,
    sms_consent_source text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parent_notification_preferences_profile_category_channel
        UNIQUE (customer_profile_id, category, channel),
    CONSTRAINT parent_notification_preferences_sms_consent_check CHECK (
        channel = 'SMS'
        OR (
            sms_consent_status IS NULL
            AND sms_consented_at IS NULL
            AND sms_consent_source IS NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS ix_parent_notification_preferences_profile_channel
    ON public.parent_notification_preferences USING btree (customer_profile_id, channel);

-- 4. Delivery attempts. A row is one event sent to one destination on one
-- channel. Destination is snapshotted so delivery history survives token
-- rotation or removal.

CREATE TABLE IF NOT EXISTS public.parent_notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.parent_notification_events(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('PUSH', 'SMS')),
    provider text NOT NULL CHECK (provider IN ('EXPO', 'TWILIO')),
    device_token_id uuid REFERENCES public.device_tokens(id) ON DELETE SET NULL,
    destination text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'RETRY', 'FAILED', 'SKIPPED'
    )),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    locked_by uuid,
    provider_ticket_id text,
    provider_receipt_status text,
    receipt_attempt_count integer NOT NULL DEFAULT 0 CHECK (receipt_attempt_count >= 0),
    last_error text,
    sent_at timestamptz,
    delivered_at timestamptz,
    receipt_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parent_notification_deliveries_event_channel_destination
        UNIQUE (event_id, channel, destination),
    CONSTRAINT parent_notification_deliveries_channel_provider_check CHECK (
        (channel = 'PUSH' AND provider = 'EXPO' AND device_token_id IS NOT NULL)
        OR (channel = 'SMS' AND provider = 'TWILIO')
    )
);

CREATE INDEX IF NOT EXISTS ix_parent_notification_deliveries_dispatch
    ON public.parent_notification_deliveries USING btree (status, next_attempt_at, created_at)
    WHERE channel = 'PUSH'
      AND provider = 'EXPO'
      AND status IN ('PENDING', 'SENDING', 'RETRY');

CREATE INDEX IF NOT EXISTS ix_parent_notification_deliveries_receipts
    ON public.parent_notification_deliveries USING btree (sent_at, id)
    WHERE channel = 'PUSH'
      AND provider = 'EXPO'
      AND status = 'SENT'
      AND provider_ticket_id IS NOT NULL;

-- 5. Fan out eligible events to active parent Expo registrations. No SMS row
-- is created. ACKNOWLEDGEMENT events from the same parent are retained as
-- events but do not create push deliveries.

CREATE OR REPLACE FUNCTION public.parent_notification_events_create_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.event_class = 'ACKNOWLEDGEMENT'
       AND NEW.actor_auth_user_id = NEW.recipient_auth_user_id THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.parent_notification_preferences preference
        WHERE preference.customer_profile_id = NEW.customer_profile_id
          AND preference.category = NEW.category
          AND preference.channel = 'PUSH'
          AND preference.enabled = false
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.parent_notification_deliveries (
        event_id,
        channel,
        provider,
        device_token_id,
        destination
    )
    SELECT
        NEW.id,
        'PUSH',
        'EXPO',
        token.id,
        token.token
    FROM public.device_tokens token
    WHERE token.auth_user_id = NEW.recipient_auth_user_id
      AND token.app_scope = 'PARENT'
      AND token.token_provider = 'EXPO'
      AND token.disabled_at IS NULL
      AND token.last_seen_at >= now() - interval '90 days'
    ON CONFLICT (event_id, channel, destination) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parent_notification_events_create_deliveries
    ON public.parent_notification_events;
CREATE TRIGGER parent_notification_events_create_deliveries
    AFTER INSERT ON public.parent_notification_events
    FOR EACH ROW EXECUTE FUNCTION public.parent_notification_events_create_deliveries();

-- 6. Staff message is the first complete event producer. The event is only
-- created for a newly inserted STAFF message; the message RPC's idempotent
-- replay does not insert another message and therefore cannot duplicate it.

CREATE OR REPLACE FUNCTION public.customer_thread_messages_create_parent_notification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    recipient_user_id_text text;
BEGIN
    IF NEW.author_type <> 'STAFF' OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT profile.supabase_user_id
    INTO recipient_user_id_text
    FROM public.customer_message_threads thread
    JOIN public.customer_profiles profile
      ON profile.id = thread.customer_profile_id
    WHERE thread.id = NEW.thread_id
      AND thread.tenant_id = NEW.tenant_id;

    IF recipient_user_id_text IS NULL
       OR recipient_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.parent_notification_events (
        tenant_id,
        customer_profile_id,
        recipient_auth_user_id,
        event_type,
        category,
        event_class,
        actor_type,
        actor_auth_user_id,
        subject_type,
        subject_id,
        dedupe_key,
        schema_version,
        payload,
        occurred_at
    )
    SELECT
        thread.tenant_id,
        thread.customer_profile_id,
        recipient_user_id_text::uuid,
        'STAFF_MESSAGE_RECEIVED',
        'MESSAGES',
        'CONTEXTUAL',
        'STAFF',
        NEW.author_auth_user_id,
        'MESSAGE',
        NEW.id,
        'staff-message:' || NEW.id::text,
        1,
        jsonb_build_object(
            'schemaVersion', 1,
            'eventType', 'STAFF_MESSAGE_RECEIVED',
            'threadId', NEW.thread_id,
            'messageId', NEW.id,
            'senderName', coalesce(nullif(btrim(NEW.author_display_name), ''), 'Your academy'),
            'preview', left(coalesce(NEW.body, ''), 120)
        ),
        NEW.created_at
    FROM public.customer_message_threads thread
    WHERE thread.id = NEW.thread_id
      AND thread.tenant_id = NEW.tenant_id
    ON CONFLICT (dedupe_key) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_thread_messages_create_parent_notification
    ON public.customer_thread_messages;
CREATE TRIGGER customer_thread_messages_create_parent_notification
    AFTER INSERT ON public.customer_thread_messages
    FOR EACH ROW EXECUTE FUNCTION public.customer_thread_messages_create_parent_notification();

-- 7. Atomically claim due Expo push deliveries. Stale SENDING rows are
-- reclaimable after ten minutes so a terminated worker cannot strand them.

CREATE OR REPLACE FUNCTION public.parent_claim_push_deliveries(
    p_limit integer DEFAULT 100,
    p_subject_id uuid DEFAULT NULL
)
RETURNS TABLE (
    delivery_id uuid,
    event_id uuid,
    device_token_id uuid,
    expo_push_token text,
    app_environment text,
    attempt_count integer,
    event_type text,
    event_class text,
    category text,
    payload jsonb,
    occurred_at timestamptz,
    recipient_auth_user_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    claim_id uuid := gen_random_uuid();
    claim_limit integer := greatest(1, least(coalesce(p_limit, 100), 100));
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT delivery.id
        FROM public.parent_notification_deliveries delivery
        JOIN public.device_tokens token ON token.id = delivery.device_token_id
        JOIN public.parent_notification_events event ON event.id = delivery.event_id
        WHERE delivery.channel = 'PUSH'
          AND delivery.provider = 'EXPO'
          AND delivery.attempt_count < 5
          AND delivery.next_attempt_at <= now()
          AND (
              delivery.status IN ('PENDING', 'RETRY')
              OR (
                  delivery.status = 'SENDING'
                  AND delivery.locked_at < now() - interval '10 minutes'
              )
          )
          AND token.app_scope = 'PARENT'
          AND token.token_provider = 'EXPO'
          AND token.disabled_at IS NULL
          AND (p_subject_id IS NULL OR event.subject_id = p_subject_id)
        ORDER BY delivery.created_at ASC, delivery.id ASC
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT claim_limit
    ), claimed AS (
        UPDATE public.parent_notification_deliveries delivery
        SET status = 'SENDING',
            attempt_count = delivery.attempt_count + 1,
            locked_at = now(),
            locked_by = claim_id,
            updated_at = now()
        FROM candidates
        WHERE delivery.id = candidates.id
        RETURNING delivery.id
    )
    SELECT
        delivery.id,
        event.id,
        token.id,
        delivery.destination,
        token.app_environment,
        delivery.attempt_count,
        event.event_type,
        event.event_class,
        event.category,
        event.payload,
        event.occurred_at,
        event.recipient_auth_user_id
    FROM claimed
    JOIN public.parent_notification_deliveries delivery ON delivery.id = claimed.id
    JOIN public.parent_notification_events event ON event.id = delivery.event_id
    JOIN public.device_tokens token ON token.id = delivery.device_token_id
    ORDER BY delivery.created_at ASC, delivery.id ASC;
END;
$$;

-- 8. updated_at, RLS, and grants.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'parent_notification_preferences_updated_at'
          AND tgrelid = 'public.parent_notification_preferences'::regclass
    ) THEN
        CREATE TRIGGER parent_notification_preferences_updated_at
            BEFORE UPDATE ON public.parent_notification_preferences
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'parent_notification_deliveries_updated_at'
          AND tgrelid = 'public.parent_notification_deliveries'::regclass
    ) THEN
        CREATE TRIGGER parent_notification_deliveries_updated_at
            BEFORE UPDATE ON public.parent_notification_deliveries
            FOR EACH ROW EXECUTE FUNCTION public.offers_set_updated_at();
    END IF;
END;
$$;

ALTER TABLE public.parent_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.parent_notification_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.parent_notification_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.parent_notification_deliveries FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.parent_notification_events TO service_role;
GRANT ALL ON TABLE public.parent_notification_preferences TO service_role;
GRANT ALL ON TABLE public.parent_notification_deliveries TO service_role;

REVOKE ALL ON FUNCTION public.parent_notification_events_create_deliveries() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_thread_messages_create_parent_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_claim_push_deliveries(integer, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.parent_notification_events_create_deliveries() TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_thread_messages_create_parent_notification() TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_claim_push_deliveries(integer, uuid) TO service_role;

-- Parent messaging follow-up indexes for foreign key checks and common reads.
-- The parent messaging tables are service-role API tables with deny-all RLS;
-- these indexes avoid delete/update FK scans as data grows.

CREATE INDEX IF NOT EXISTS ix_customer_message_threads_subject_student
    ON public.customer_message_threads USING btree (subject_student_id);

CREATE INDEX IF NOT EXISTS ix_customer_thread_messages_author_profile_created
    ON public.customer_thread_messages USING btree (author_customer_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_customer_thread_messages_thread_tenant
    ON public.customer_thread_messages USING btree (thread_id, tenant_id);

CREATE INDEX IF NOT EXISTS ix_customer_thread_reads_customer_profile
    ON public.customer_thread_reads USING btree (customer_profile_id);

CREATE INDEX IF NOT EXISTS ix_customer_thread_reads_tenant_auth_user
    ON public.customer_thread_reads USING btree (tenant_id, auth_user_id);

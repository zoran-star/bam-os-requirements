-- Hardening for 20260726022703_signed_agreements.sql.
--
-- The live project got the base migration BEFORE these two fixes were folded
-- into it, so this migration exists to bring it in line. On a fresh replay the
-- base migration already creates these correctly and this is a harmless no-op.
--
-- 1. member_consents was created as a SECURITY DEFINER view (the Postgres
--    default), which BYPASSES row level security on member_agreements - any
--    authenticated user could have read every academy's consent data through
--    it. security_invoker makes the view run as the caller, so the
--    member_agreements policies apply. (Supabase advisor: security_definer_view)
-- 2. The trigger functions had a role-mutable search_path. Their bodies fully
--    qualify every object, so pinning it empty is safe and blocks
--    search_path-shadowing. (advisor: function_search_path_mutable)

alter view public.member_consents set (security_invoker = on);

alter function public.agreement_documents_single_current() set search_path = '';
alter function public.agreement_documents_immutable() set search_path = '';

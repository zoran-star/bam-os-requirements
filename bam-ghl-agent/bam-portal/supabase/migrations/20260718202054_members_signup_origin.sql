-- members.signup_origin - marks HOW a payment_method_required row was born so the
-- roster can hide pre-payment enroll-form shells while keeping real members that
-- are merely collecting a card.
--
--   'website_enroll'  step 1 of the public enroll form (api/website/checkout.js).
--                     A lead who started checkout but has not paid. NOT a member -
--                     stays a lead in the pipeline (Done Trial) until paid.
--   'convert'         staff "convert to member" from a pipeline card
--                     (api/ghl/pipelines.js action=convert). Same pre-payment shell.
--   'wizard'          returning-client wizard Door B shell (api/members/enroll.js).
--                     No longer created (the wizard now hands staff the enroll
--                     link instead) - value kept for historical rows.
--   'collecting'      an EXISTING member flipped to payment_method_required while
--                     staff collect a card (api/members.js card-setup-link with
--                     mark_collecting, CoachIQ collecting). Stays on the roster.
--   NULL              unknown/legacy - stays on the roster (safe default).
--
-- Roster rule (api/members.js GET): hide rows WHERE status='payment_method_required'
-- AND signup_origin IN ('website_enroll','convert','wizard'). Everything else shows.

alter table public.members
  add column if not exists signup_origin text
  check (signup_origin in ('website_enroll', 'convert', 'wizard', 'collecting'));

comment on column public.members.signup_origin is
  'How a payment_method_required row was born: website_enroll | convert | wizard (pre-payment shells, hidden from the roster) | collecting (real member collecting a card, visible). NULL = legacy/unknown, visible.';

-- ── Backfill from member_audit_log ─────────────────────────────────────────────
-- Only rows still sitting at payment_method_required need classifying; once a row
-- goes live the origin no longer matters for visibility (but is stamped forward
-- by the creators from now on).

-- 1. Public enroll form starters (website enroll checkout, the portal onboarding
--    funnel checkout, and the GHL form-submitted intake webhook - all the same
--    semantic: filled an enroll form, never paid).
update public.members m
   set signup_origin = 'website_enroll'
 where m.status = 'payment_method_required'
   and m.signup_origin is null
   and exists (
     select 1 from public.member_audit_log l
      where l.member_id = m.id
        and l.action_type in ('website-enrollment-checkout-created', 'onboarding-checkout-created', 'intake-ghl')
   );

-- 2. Pipeline-card converts.
update public.members m
   set signup_origin = 'convert'
 where m.status = 'payment_method_required'
   and m.signup_origin is null
   and exists (
     select 1 from public.member_audit_log l
      where l.member_id = m.id
        and l.action_type = 'convert-from-pipeline'
   );

-- 3. Returning-client wizard Door B shells (no card link path).
update public.members m
   set signup_origin = 'wizard'
 where m.status = 'payment_method_required'
   and m.signup_origin is null
   and exists (
     select 1 from public.member_audit_log l
      where l.member_id = m.id
        and l.action_type = 'enroll-returning'
        and l.args->>'door' = 'card_link'
   );

-- 3b. Sorter-imported members that arrived as "collecting payment" (sheet status)
--     are real members awaiting a card - visible.
update public.members m
   set signup_origin = 'collecting'
 where m.status = 'payment_method_required'
   and m.signup_origin is null
   and exists (
     select 1 from public.member_audit_log l
      where l.member_id = m.id
        and l.action_type = 'sorter-promote'
   );

-- 4. Card-collecting members (staff sent a card-setup link with mark_collecting) -
--    explicitly visible. Runs LAST so a member that both started on the website
--    AND later got a collecting link stays visible (staff clearly consider them
--    a member being fixed, not an abandoned signup).
update public.members m
   set signup_origin = 'collecting'
 where m.status = 'payment_method_required'
   and exists (
     select 1 from public.member_audit_log l
      where l.member_id = m.id
        and l.action_type = 'card-setup-link'
        and (l.db_changes is not null)
   );

-- The academy's BUSINESS email, split off from the OWNER's.
--
-- ⚠️ NOT APPLIED YET. Ledger row is in supabase/PENDING_SQL.md. Read the
-- "BEFORE YOU DEPLOY" note at the bottom of this file: until this is applied AND
-- seeded, automation email for BAM GTA HOLDS instead of sending. That is the
-- designed refusal, not a bug, but it is not a state to leave sitting.
--
-- THE BUG THIS REMOVES
-- There was no column for an academy's public email, so the system published the
-- owner's. api/email-shells.js resolved `location_email` from `clients.email`, and
-- that one value fed three things at once:
--   1. the contact line in every automation email's footer
--   2. {{SUPPORT_EMAIL}}, the footer "Email" link
--   3. the UNSUBSCRIBE destination (mailto:<that address>?subject=Unsubscribe)
-- BAM GTA's `clients.email` is zoran@byanymeansbball.com - Zoran's personal inbox -
-- so every GTA email published it to parents and pointed unsubscribes at it. DETAIL
-- Miami and Johnson Bball both carry mike@byanymeansbball.com, the same shape.
-- GTA was saved from looking wrong only by a hardcoded LOCATIONS entry in
-- email-shells.js, which no other academy has.
--
-- TWO DIFFERENT FACTS, TWO COLUMNS, AND THAT IS THE WHOLE POINT
--   clients.email          - the OWNER. Who WE contact. Stays exactly as it is;
--                            nothing moves out of it, nothing is copied from it.
--   clients.business_email - the ACADEMY. What PARENTS see, reply to and
--                            unsubscribe through.
-- The PHONE half of this pair already worked this way before today: `clients.phone`
-- is the academy's public number (GTA's is (289) 816-6569, not Zoran's mobile) and
-- renders as {{location.phone}}. This column is the email that was missing beside it.
-- Do NOT add a second phone column.
--
-- NO FALLBACK, ON PURPOSE. An empty business_email does NOT borrow clients.email.
-- Borrowing is the bug. It also makes the bug invisible, because a field that
-- renders something looks configured. Empty means the footer contact line and the
-- footer Email link do not render at all, and - because an email with no
-- unsubscribe path is worse than one with a wrong address - the SEND ITSELF HOLDS
-- (api/_send.js, same shape as the unverified-sending-domain hold: held, never
-- sent generic, owner texted at most once per 24h).
--
-- WHAT THE FIELD REQUIRES, which a text column cannot enforce
-- Zoran's ruling 2026-07-29: this must be the address actually connected to Resend
-- (so it can SEND) and to Gmail (so replies reach a human). An address stored
-- without both is a from-address that looks configured, bounces, and drops replies
-- into nowhere. Nothing here verifies that. The Business Basics card says so in the
-- hint and shows the one cheap signal that already exists (clients.email_domain vs
-- this address's domain). Real verification is a later build.
--
-- ALL ADDITIVE. Nothing renamed, dropped or rewritten.

alter table public.clients add column if not exists business_email text;

comment on column public.clients.business_email is
  'The academy''s PUBLIC email: what parents see in the footer, what {{SUPPORT_EMAIL}} links, and where the unsubscribe mailto points. NOT clients.email (that is the OWNER, who WE contact). Empty NEVER falls back to clients.email - it drops the footer contact line and HOLDS the send, because an email with no unsubscribe path is worse than one with a wrong address. Must be an address connected to Resend for sending and Gmail for replies; nothing enforces that yet.';

-- ─────────────────────────────────────────────────────────────────────────────
-- update_client_basics: whitelist business_email + the three Google reading cols
-- ─────────────────────────────────────────────────────────────────────────────
-- Transcribed from 20260727140000 (the FULL current whitelist) with four columns
-- appended. The three google_* columns were deliberately left out of that
-- migration's whitelist because three other workstreams were editing this function
-- at the time; they are picked up here, with the Business Basics card that writes
-- them, so the pair is never half-shipped.
--
-- THE RATING TRIPLE MOVES TOGETHER OR NOT AT ALL. clients_google_rating_pair_check
-- refuses "4.9 stars, no count" and "67 reviews, no rating" - and a constraint
-- violation aborts the WHOLE update, so a half-set patch would also lose the
-- unrelated field the owner was editing in the same keystroke and surface a raw
-- Postgres error in the portal. So a half is IGNORED here instead: the two columns
-- keep their stored values and the rest of the patch still saves. The card refuses
-- to send a half in the first place and says why; this is the backstop.
--
-- google_rating_checked_at is STAMPED, never typed: any writer that sets the pair
-- and omits the date gets now(), and clearing the pair clears the date with it. A
-- rating nobody can date reads as current forever, which is the whole reason the
-- column exists.
CREATE OR REPLACE FUNCTION public.update_client_basics(p_client_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_authorized boolean;
  v_rating     text;
  v_count      text;
  v_pair       boolean;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN false; END IF;

  -- Both keys present, and both either set or both cleared. Anything else is a
  -- half and is ignored (see the note above).
  v_rating := NULLIF(p_patch->>'google_rating', '');
  v_count  := NULLIF(p_patch->>'google_review_count', '');
  v_pair   := (p_patch ? 'google_rating') AND (p_patch ? 'google_review_count')
              AND ((v_rating IS NULL) = (v_count IS NULL));

  UPDATE clients SET
    business_name = COALESCE(NULLIF(p_patch->>'business_name', ''), business_name),
    owner_name    = COALESCE(NULLIF(p_patch->>'owner_name', ''),    owner_name),
    email         = COALESCE(NULLIF(p_patch->>'email', ''),         email),
    legal_name    = CASE WHEN p_patch ? 'legal_name'  THEN NULLIF(p_patch->>'legal_name','')  ELSE legal_name  END,
    address       = CASE WHEN p_patch ? 'address'     THEN NULLIF(p_patch->>'address','')     ELSE address     END,
    phone         = CASE WHEN p_patch ? 'phone'       THEN NULLIF(p_patch->>'phone','')       ELSE phone       END,
    entity_type   = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(p_patch->>'entity_type','') ELSE entity_type END,
    ein           = CASE WHEN p_patch ? 'ein'         THEN NULLIF(p_patch->>'ein','')         ELSE ein         END,
    time_zone     = CASE WHEN p_patch ? 'time_zone'   THEN NULLIF(p_patch->>'time_zone','')   ELSE time_zone   END,
    brand_data    = CASE WHEN p_patch ? 'brand_data'  THEN COALESCE(p_patch->'brand_data', brand_data) ELSE brand_data END,
    kpi_data      = CASE WHEN p_patch ? 'kpi_data'    THEN COALESCE(p_patch->'kpi_data', kpi_data)     ELSE kpi_data   END,
    onboarding_setup = CASE WHEN p_patch ? 'onboarding_setup' THEN COALESCE(p_patch->'onboarding_setup', onboarding_setup) ELSE onboarding_setup END,
    ads_content_approval_required = CASE WHEN p_patch ? 'ads_content_approval_required'
      THEN COALESCE((p_patch->>'ads_content_approval_required')::boolean, ads_content_approval_required)
      ELSE ads_content_approval_required END,
    tax_config    = CASE WHEN p_patch ? 'tax_config'  THEN NULLIF(p_patch->'tax_config', 'null'::jsonb) ELSE tax_config END,
    public_name   = CASE WHEN p_patch ? 'public_name' THEN NULLIF(p_patch->>'public_name','') ELSE public_name END,
    community_group_url = CASE WHEN p_patch ? 'community_group_url'
      THEN NULLIF(p_patch->>'community_group_url','') ELSE community_group_url END,
    community_group_platform = CASE WHEN p_patch ? 'community_group_platform'
      THEN NULLIF(p_patch->>'community_group_platform','') ELSE community_group_platform END,
    google_review_url = CASE WHEN p_patch ? 'google_review_url'
      THEN NULLIF(p_patch->>'google_review_url','') ELSE google_review_url END,
    -- The academy's public email. Blank CLEARS it, and clearing is a real choice:
    -- it means "we have no public address yet", which holds sends rather than
    -- publishing the owner's.
    business_email = CASE WHEN p_patch ? 'business_email'
      THEN NULLIF(p_patch->>'business_email','') ELSE business_email END,
    google_rating       = CASE WHEN v_pair THEN v_rating::numeric ELSE google_rating       END,
    google_review_count = CASE WHEN v_pair THEN v_count::integer  ELSE google_review_count END,
    google_rating_checked_at = CASE
      WHEN v_pair AND v_rating IS NULL THEN NULL
      WHEN v_pair THEN COALESCE(NULLIF(p_patch->>'google_rating_checked_at','')::timestamptz, now())
      ELSE google_rating_checked_at END
  WHERE id = p_client_id;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_client_basics(uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_client_basics(uuid, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the two academies that have a public address today
-- ─────────────────────────────────────────────────────────────────────────────
-- GTA's value is the one that was hardcoded in email-shells.js LOCATIONS, so this
-- is a MOVE from code to data, not a new fact: its rendered emails come out
-- byte-identical (api/__goldens__/bam-gta-steps locks that).
-- San Jose's is Lij's academy address, which happens to equal its clients.email -
-- same string, two different facts, and the owner column is not touched either way.
--
-- Only writes where the column is still NULL, so re-running cannot overwrite a
-- value an owner has since typed in Business Basics. Matched by id, and no other
-- academy is touched: an academy with no public address on file must stay empty
-- rather than be guessed at.
update public.clients set business_email = 'info@byanymeanstoronto.ca'
 where id = '39875f07-0a4b-4429-a201-2249bc1f24df' and business_email is null;
update public.clients set business_email = 'elijah@byanymeanssanjose.com'
 where id = '5576acf0-acd3-4c05-9f9f-ebfde8618154' and business_email is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE YOU DEPLOY
-- ─────────────────────────────────────────────────────────────────────────────
-- The code half of this change removes the `email:` line from GTA's hardcoded
-- LOCATIONS entry, so from that commit on the ONLY source of a public email is this
-- column. Until this migration is applied AND the two seeds above have run:
--   - api/_send.js resolves no business email -> every automation email HOLDS
--     (nothing wrong goes out, the engine re-queues, the owner is texted once per
--     24h), and
--   - the Business Basics card's card-scoped load 400s on business_email; the load
--     falls back to fetching those columns one at a time so the rest of the card
--     still hydrates, and the field stays blank AND unsaveable rather than writing
--     a blank over anything.
-- Neither state loses data. Both stop GTA's parent email. Apply this first.
--
-- DELIBERATELY NOT IN THIS MIGRATION
-- 1) business_email is NOT added to the client SELECT lists in api/automations.js
--    or api/agent-confirm.js. The rule written at loadClient() there is explicit:
--    a column joins that list AFTER its migration is live, because naming a column
--    that does not exist 400s the whole select and stops every automation. The send
--    path reads business_email through its own separately-caught query
--    (clientSender in api/_send.js) so it degrades to "no business email" instead.
--    Once this is applied, that column can move into the two select lists and the
--    second query can go.
-- 2) Nothing verifies the address sends or receives. See the note at the top.
-- 3) Nothing CONSUMES google_rating / google_review_count. They are stored and
--    displayed as a dated reading and nothing else. A reader shipped ahead of its
--    data is the "inert until configured" argument this repo no longer accepts.

-- The academy's own TAGLINE and INSTAGRAM, moved out of code into its row.
--
-- ⚠️ NOT APPLIED YET. Ledger row is in supabase/PENDING_SQL.md. Read "BEFORE YOU
-- DEPLOY" at the bottom: there is a real, quiet interim cost here, and it needs two
-- select lists updated the moment this lands.
--
-- WHAT THIS IS PART OF
-- api/email-shells.js carries a LOCATIONS map keyed by client id. It has exactly ONE
-- entry, BAM GTA's, and it is the last academy-specific literal in the email layer.
-- Every other academy's identity is derived from its own clients row by locFromVars().
-- Two of the fields that entry pinned had no column behind them at all:
--   tagline    - the sentence under the wordmark in the black footer of every email
--   instagram  - the footer "Instagram" link, in all ten designed templates
-- locFromVars() hardcoded both to "", so those two facts existed for GTA and for
-- nobody else. These are the columns. Once they are applied and seeded, the row is
-- the source and the fix reaches every academy at once instead of one.
--
-- NAMED LIKE THEIR NEIGHBOURS. clients already carries business_email,
-- google_review_url, community_group_url and online_programs_url: a link fact takes
-- the `_url` suffix, a plain string does not. So `instagram_url` (the full profile
-- URL, which is what the footer anchor's href needs) and `tagline`.
--
-- NO FALLBACK, same rule as business_email. An empty tagline renders no tagline
-- sentence and an empty instagram_url renders NO Instagram link at all -
-- dropEmptyShellLinks takes the empty anchor out with its dot separator rather than
-- shipping a link to nowhere. Neither may ever borrow another academy's value: an
-- academy publishing someone else's Instagram handle is worse than publishing none.
--
-- ALL ADDITIVE. Nothing renamed, dropped or rewritten.

alter table public.clients add column if not exists tagline text;
alter table public.clients add column if not exists instagram_url text;

comment on column public.clients.tagline is
  'One sentence describing the academy, rendered under the wordmark in the black footer of every automation email ({{TAGLINE}}). Empty renders no tagline sentence and NEVER borrows another academy''s - identity fails to empty, not to somebody else.';
comment on column public.clients.instagram_url is
  'The academy''s Instagram profile URL, the footer "Instagram" link in every automation email ({{INSTAGRAM_URL}}). Full URL, not a handle: it is used directly as the anchor href. Empty removes the link and its separator rather than rendering a dead one.';

-- ─────────────────────────────────────────────────────────────────────────────
-- update_client_basics: whitelist tagline + instagram_url
-- ─────────────────────────────────────────────────────────────────────────────
-- TRANSCRIBED, NOT REWRITTEN, and it is a SUPERSET of two things at once:
--   1. the LIVE function, read out of pg_proc.prosrc on 2026-07-29 (18 settable
--      columns: business_name, owner_name, email, legal_name, address, phone,
--      entity_type, ein, time_zone, brand_data, kpi_data, onboarding_setup,
--      ads_content_approval_required, tax_config, public_name, community_group_url,
--      community_group_platform, google_review_url), and
--   2. 20260729T210000_clients_business_email.sql, which is NOT APPLIED YET and adds
--      four more (business_email + the google_rating triple).
-- Both were read side by side and every settable column from each appears below, plus
-- the two new ones - 24 in total. A column dropped from this list does not error: the
-- field it backs just silently stops saving, which is why this is transcribed rather
-- than reconstructed from memory.
--
-- WHICHEVER ORDER THESE TWO ARE APPLIED IN, the result is the same function. If
-- 20260729T210000 lands after this one it replays its own 22-column version and DROPS
-- tagline + instagram_url - so if you apply them out of order, apply this one LAST.
-- The ledger lists them in order for that reason.
--
-- The google_rating triple rules are carried over verbatim from that migration and
-- the reasoning still applies: clients_google_rating_pair_check refuses a half, a
-- constraint violation aborts the WHOLE update (losing the unrelated field the owner
-- was editing in the same keystroke), so a half is IGNORED rather than attempted, and
-- google_rating_checked_at is STAMPED by the function, never typed.
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
    -- The two new ones. Blank CLEARS, for the same reason: an academy with no tagline
    -- on file must render no tagline, not the last one anybody typed.
    tagline       = CASE WHEN p_patch ? 'tagline'      THEN NULLIF(p_patch->>'tagline','')      ELSE tagline      END,
    instagram_url = CASE WHEN p_patch ? 'instagram_url' THEN NULLIF(p_patch->>'instagram_url','') ELSE instagram_url END,
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
-- Seed BAM GTA, the one academy that has these two facts today
-- ─────────────────────────────────────────────────────────────────────────────
-- These are the EXACT strings that were hardcoded in email-shells.js LOCATIONS, so
-- this is a move from code to data and not a new fact: GTA's ten rendered emails come
-- out byte-identical across it (api/__goldens__/bam-gta locks that, and
-- api/_tagline-instagram.test.mjs proves the values now come from the row).
--
-- THE INSTAGRAM URL IS THE SHORT FORM ON PURPOSE. Not www, no trailing slash.
-- "Canonicalising" it would change the footer link in all ten templates to match one
-- hand-written link elsewhere. Same account either way; do not normalise it.
--
-- Only writes where the column is still NULL, so a re-run cannot overwrite something
-- an owner has since typed in Business Basics. No other academy is touched: an
-- academy with no tagline or Instagram on file must stay empty rather than be guessed
-- at. San Jose is deliberately NOT seeded - nobody has decided its tagline, and a
-- placeholder in a parent-facing footer is worse than a shorter footer.
update public.clients
   set tagline = 'Youth and high-school basketball training in Oakville and across the GTA.'
 where id = '39875f07-0a4b-4429-a201-2249bc1f24df' and tagline is null;
update public.clients
   set instagram_url = 'https://instagram.com/byanymeanstoronto'
 where id = '39875f07-0a4b-4429-a201-2249bc1f24df' and instagram_url is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE YOU DEPLOY
-- ─────────────────────────────────────────────────────────────────────────────
-- The code half removes `tagline` and `instagram` from GTA's hardcoded LOCATIONS
-- entry, so from that commit the ONLY source of either is these columns. That leaves a
-- window with a QUIET cost, and quiet is the part to be honest about:
--
--   Until this migration is applied AND the two columns are added to the loadClient
--   select lists in api/automations.js and api/agent-confirm.js, BAM GTA's automation
--   emails render with NO tagline sentence and NO footer Instagram link.
--
-- Nothing breaks, nothing is borrowed, no dead link ships, no send is held - the
-- footer is just two elements shorter than it is today. That is a real regression in
-- GTA's live email and it does not announce itself, unlike the business_email hold.
-- So this migration and that select-list edit are ONE job:
--
--   1. apply this file
--   2. add `tagline` and `instagram_url` to CLIENT_COLS in loadClient() in
--      api/automations.js (the send worker, the owner approval surface and the Sales
--      step preview all read that one row) and in api/agent-confirm.js
--
-- ⚠️ AND DO NOT SHORTCUT STEP 2 BY PUTTING THEM IN CLIENT_COLS_PENDING FIRST.
-- Those files grew a pending-column retry for business_email: a column can be named
-- optimistically and is dropped on the one PostgREST error (42703) that means "not
-- migrated yet". It is tempting to use it here and skip the interim entirely. It is
-- NOT safe for a SECOND pending column, and this was measured, not assumed:
--   - Postgres names only the FIRST unknown column in a select. Verified against
--     production on 2026-07-29: `select tagline, instagram_url from clients` returns
--     `42703: column "tagline" does not exist` and never mentions instagram_url.
--   - The retry in all three callers (loadClient in api/automations.js and
--     api/agent-confirm.js, clientSender in api/_send.js) is SINGLE-SHOT: it drops the
--     blamed column and re-reads OUTSIDE the try. A second unknown column in the
--     re-read throws uncaught.
-- So with business_email, tagline and instagram_url all pending at once, the first read
-- 400s, the retry drops one, the second read 400s again and loadClient THROWS - which
-- stops every automation job, SMS included. That is the exact incident the rule was
-- written after, reintroduced through the mechanism built to prevent it.
-- Fixing the retry to loop until nothing is blamed (or to drop ALL pending columns on
-- the first pending-column error, which is what _bbHydrateClientCols effectively does
-- per column) would make the shortcut safe. Until someone does that and extends
-- api/_pending-client-column.test.mjs to TWO pending columns, step 2 waits for step 1.
--
-- DELIBERATELY NOT IN THIS MIGRATION
-- 1) The LOCATIONS map is NOT deleted, and this migration does not make it deletable.
--    That was the goal; it turned out to be wrong, and the measurement is recorded
--    here so nobody has to re-derive it. Rendering GTA's ten templates through the
--    row-only path instead of the pinned entry changes ALL TEN. Six fields are
--    responsible, not two:
--      tagline        10/10 templates - FIXED by this migration
--      instagram      10/10 templates - FIXED by this migration
--      suffix         10/10 - the gold wordmark word. Pinned "GTA"; derived from
--                     public_name it becomes "BASKETBALL", so the footer would read
--                     BY ANY MEANS BASKETBALL. A brand decision, not a refactor.
--      full           10/10 - pinned "By Any Means Toronto"; the row's public_name is
--                     "By Any Means Basketball". Reaches the <title> and the footer
--                     reason sentence. The map and the row genuinely disagree about
--                     GTA's parent-facing name and only the owner can settle it.
--      locationTag     8/10 - pinned "OAKVILLE &middot; GTA", a hand-composed string.
--                     The derived form is just the uppercased city, so there is no
--                     row-backed path to it at all.
--      city            4/10 - derived by cityFromAddress(), which returns "" for
--                     GTA's stored address "2205 Rosemount Cres" (no city in it).
--    The other five fields the entry carries (ownerFirst, siteUrl, siteLabel,
--    onlineProgramsUrl, referralOffer) are already byte-identical from the row and
--    could be dropped from the entry today with no render change at all.
-- 2) Nothing validates that instagram_url points at a real, live profile.

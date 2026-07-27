-- ── clients.brand_data reshape ────────────────────────────────────────────
--
-- NOT APPLIED. Written 2026-07-27, deliberately left unapplied. Apply it
-- through the normal linked flow (supabase/README.md) only AFTER the code that
-- adapts every reader is deployed, because this migration removes the keys
-- those readers used to fall back to.
--
-- brand_data held 19 keys mixing three different kinds of thing. It keeps only
-- the first kind: brand identity the owner authors and nobody can compute.
--
--   KEEP   story, why_us, proof, dream_athletes, notes,
--          color_primary, color_secondary, color_accent,
--          font_display, font_body,
--          logo_dark_url, logo_light_url, icon_url
--
--   DROP   stats        Free text about live facts, so it was stale by design.
--                       BAM GTA's said "Mon/Wed/Fri evening training" and
--                       "43+ active members". Its schedule_slots run
--                       Mon/Tue/Wed/Thu/Sat (GTA has never trained on a
--                       Friday) and it has 47 members. Derived at render now,
--                       from members + schedule_slots + address
--                       (api/_brand-stats.js).
--          domain       Duplicate of website_setup.domain, which the domain
--          website_url  wizard owns. Two hand-typed copies of one value drift
--                       apart the moment anyone edits one of them.
--
--   MOVE   site_pages       -> website_setup.site_pages  (website state)
--          website_status   -> onboarding_setup.*        (intake answers)
--          references       -> onboarding_setup.*
--
-- Everything below is idempotent and can be re-run safely.

begin;

-- ── Step 1: finish the domain backfill BEFORE dropping the source keys ──
--
-- An earlier backfill populated website_setup.domain for 9 of the 11 clients
-- that hold a brand_data domain, not 10. Verified 2026-07-27 against prod:
-- "Locked In Sports" has brand_data.website_url = 'lockedinsports.com' and NO
-- website_setup.domain, so dropping the key without this step would silently
-- lose that academy's only stored website. ("Pro Precision" holds the keys but
-- both values are blank, so it is correctly a no-op.)
--
-- Prefers brand_data.domain, falls back to website_url, strips the scheme and
-- any trailing slash. Never overwrites a website_setup.domain that already has
-- a value - the wizard's copy always wins.
update clients
   set website_setup = coalesce(website_setup, '{}'::jsonb)
                     || jsonb_build_object('domain', regexp_replace(
                          regexp_replace(
                            coalesce(
                              nullif(trim(brand_data->>'domain'), ''),
                              nullif(trim(brand_data->>'website_url'), '')
                            ), '^https?://', '', 'i'),
                          '/+$', ''))
 where brand_data is not null
   and coalesce(
         nullif(trim(brand_data->>'domain'), ''),
         nullif(trim(brand_data->>'website_url'), '')
       ) is not null
   and nullif(trim(coalesce(website_setup->>'domain', '')), '') is null;

-- ── Step 2: move site_pages onto website_setup ──
update clients
   set website_setup = coalesce(website_setup, '{}'::jsonb)
                     || jsonb_build_object('site_pages', brand_data->'site_pages')
 where jsonb_typeof(brand_data->'site_pages') = 'array'
   and website_setup->'site_pages' is null;

-- ── Step 3: move the two intake answers onto onboarding_setup ──
-- Existing onboarding_setup answers win: this only fills keys that are absent
-- there, so re-running can never clobber a newer answer.
update clients
   set onboarding_setup =
         coalesce(onboarding_setup, '{}'::jsonb)
         || (case when brand_data ? 'website_status' and not (coalesce(onboarding_setup,'{}'::jsonb) ? 'website_status')
                  then jsonb_build_object('website_status', brand_data->'website_status')
                  else '{}'::jsonb end)
         || (case when brand_data ? 'references' and not (coalesce(onboarding_setup,'{}'::jsonb) ? 'references')
                  then jsonb_build_object('references', brand_data->'references')
                  else '{}'::jsonb end)
 where brand_data ?| array['website_status','references'];

-- ── Step 4: drop the five keys from brand_data ──
update clients
   set brand_data = brand_data - 'stats' - 'domain' - 'website_url'
                               - 'site_pages' - 'website_status' - 'references'
 where brand_data ?| array['stats','domain','website_url','site_pages','website_status','references'];

comment on column clients.brand_data is
  'Brand identity the owner authors: story, why_us, proof, dream_athletes, notes, three colours, two fonts, three logo URLs. Nothing derivable belongs here. The website lives on website_setup.domain, the page inventory on website_setup.site_pages, intake answers on onboarding_setup, and brand stats are counted at render from members + schedule_slots + address (api/_brand-stats.js).';

commit;

-- ── Verification (run after applying) ──
-- Expect 0 rows:
--   select id, business_name from clients
--    where brand_data ?| array['stats','domain','website_url','site_pages','website_status','references'];
-- Expect every academy that had a website to still have one:
--   select count(*) from clients where nullif(trim(website_setup->>'domain'),'') is not null;   -- expect 10

# Testimonials store + Google rating (TESTIMONIAL CONNECTION)

**The store:** `testimonials` table, live in prod, one table for typed AND future
Google-synced quotes (`source` = 'manual' | 'google'). `testimonials_guard_source`
trigger enforces the hierarchy in the database: non-staff cannot write a google
row, cannot put `rating`/`external_id`/`review_created_at`/`synced_at` on a manual
row, and google rows are read-only except `starred`. Do NOT create a
`google_reviews` table - one-table ruling, 2026-07-27.

**The aggregate (applied to prod 2026-07-29, migration
`20260729T000000_client_google_rating.sql` / mcp `client_google_rating`):**
- `clients.google_rating` numeric(2,1), `clients.google_review_count` integer,
  `clients.google_rating_checked_at` timestamptz
- Constraints: range 1.0-5.0, count >= 0, and BOTH-OR-NEITHER (rating and count
  set together or both null)
- A POINT-IN-TIME READING taken via Claude in Chrome from the owner's Business
  Profile, NOT synced. UI must label it "what Google showed on <date>".
- `update_client_basics` deliberately NOT extended; card wiring is the templating
  room's single card pass. Do not add these to the Business Basics card yourself.

**Zoran's rulings (2026-07-29):** quotes stay plain, the rating is real (typed
quotes never wear stars/badges/dates and never move the aggregate); max FIVE
stored testimonials per academy; gather in the branding-deck skill, sales system
only READS; approval happens in Claude Code chat, nothing writes without a human
picking the quotes; truncated reviews are not approvable; San Jose uses its OWN
listing only (By Any Means San Jose, 5.0/22).

**Extraction route:** owner view (business.google.com/reviews or the search-page
owner panel) via Claude in Chrome; "View full review" expands full text there.
The PUBLIC Maps page truncates behind an unopenable "See more" - never use it.

**The guard:** `bam-portal/scripts/check-testimonial-hardcodes.mjs` FAILS when a
hardcoded testimonial (fabricated corpus or any store quote pasted into source)
appears in bam-client-sites or the portal's email/agent files. Exempt while
ruled stay-as-is: detail-miami, supreme-hoops-training (a FOURTH fabricated-
reviews academy, found by this check's first run 2026-07-29). Run it before
declaring any consumer converted. STANDING RULE (orchestrator, 2026-07-29): CI
runs only the corpus half and reports itself DEGRADED - no Supabase secrets in
Actions, deliberately. The FULL check (with env, store-quote half included)
must be run locally before merging any PR that touches testimonial content.

**LIVE STATE 2026-07-29 (end of day):** GTA store 5 rows/2 starred + 4.9/67;
SAN JOSE store 5 rows/2 starred + 5.0/22 (its OWN listing). Consumers reading the
store: GTA free-trial page, GTA homepage, GTA enroll flow, agent `social_proof`
(all academies - the hardcoded Toronto link is DELETED), and `nurture-3` +
`onboarding-testimonials` via the `{{location.testimonials}}` token. **SJ's
nurture-3 step is now ENABLED** (its automation is still unapproved, which is a
separate launch-day switch). Order mattered: the step was only flipped AFTER the
store-backed template deployed, because flipping first would have sent GTA's
"Parent of Adam" re-attributed to San Jose.

**⛔ ZERO DISABLED STEPS IS NORMAL NOW.** Until 2026-07-29 San Jose's nurture-3
was the ONLY disabled step across all academies and was used as a canary ("1
disabled step" = the hold is intact). The hold existed because the template
carried GTA's parents hardcoded. That precondition shipped, so the hold was
deliberately RELEASED. **"0 disabled" does NOT mean the never-flip-enabled rule
was violated.** The drift reconciler replaced the canary: it watches whether a
live step quotes a store that cannot support it, which is what the canary only
implied.

**Render path:** `academyFacts` -> `location_testimonials` -> `email-shells`
`testimonialsHtml()` -> `{{location.testimonials}}` token, in DROP_WHEN_EMPTY so
an empty store drops the block AND its lead-in. Verified by
`scripts/verify-nurture3-from-store.mjs` (in portal CI, no DB needed).

**⚠️ The generated file `api/email-templates/nurture-emails.js` says "re-run the
generator" and THE GENERATOR IS IN NEITHER REPO.** It is also not a byte copy of
`bam-client-sites/system/emails/nurture/*.html` - replacing it wholesale from
source broke a FOOTER_REASON guard. Edit both surgically and in step.

**The skill:** repo-root `.claude/skills/testimonials/SKILL.md`. Filling the
store is only half the build: free-trial cards, testimonial emails, agent
social_proof and website review CTAs must all pull from the store/resolver, per
Zoran 2026-07-29.

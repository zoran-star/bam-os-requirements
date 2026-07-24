# BUILD HANDOFF: Google Reviews (Build 5 of the sales-system entity work)

**Written 2026-07-24 by the BAM V2 engineering session (branch `claude/bam-v2-engineering-build-fc4f9d`, PRs #1560-#1577).**
Audience: a NEW chat building the Google Reviews system end to end. Spec below is workshopped and CONFIRMED by Zoran - build it as written; workshop only what it explicitly leaves open.

## What you are building (one paragraph)

Each academy connects its Google Business Profile once; reviews sync into the portal daily; ONE curated feed (starred favorites first, then highest-to-lowest, anything below 4 stars auto-hidden everywhere) powers BOTH the academy's website reviews section AND the sales agents' `social_proof` brain section (rendered live, 9th fact). A new **Reviews card in the Business Blueprint** is where owners connect + star. Owners get notified on every new review, with a special louder notification for 1-star.

## Context you MUST absorb first

1. Read `bam-ghl-agent/memories/project_sales_systems_plug_and_play.md` and `project_build2_agent_facts_derived.md` - the 3-tier ownership model + the fact-render architecture this plugs into.
2. **The fact pattern (already live for 8 facts):** `bam-ghl-agent/bam-portal/api/agent/fact-render.js` renders agent brain sections from real sources at prompt-build time via `derivedFactOverrides(clientId, sbFn, opts)` (60s cache, fail-to-{} safety, `FACT_SOURCES` + `FACT_KEYS` exports powering source labels, "Edit the brain" jumps and the brain-health strip in `api/agent-train.js` + `public/client-portal.html`). `social_proof` is currently the LAST hardcoded/typed section - your build replaces it with a renderer.
3. **Tier model:** the reviews FEED is tier-3 (the academy's own facts, per-academy Google connect); the curation RULES (starred first, rating sort, <4-star hidden) are tier-1 master logic - same for every academy, no per-academy rule forks.
4. This is persistent-data/backend work: run the `align-core-data-model` skill when designing the schema and honor its Production Data Guardrails (additive schema; `client_id` tenant scope on every row; provider ids like the Google review id / place id / account id stored explicitly; `created_at`/`updated_at` on durable tables; names are labels, never identifiers).

## CONFIRMED decisions (Zoran, 2026-07-23/24 - do not re-litigate)

- **Door B: Google Business Profile API with per-academy owner OAuth.** We need ALL reviews (starring + hide-below-4 + agent ammo are meaningless over the Places API's ~5 picked reviews). Door A (Places API, key-only) is permitted ONLY as an optional day-one stopgap for the website's aggregate stars while Google approves our Business Profile API access - do not build curation on it.
- **New Business Blueprint card: "Reviews"** - connect button + status, full review list (stars/text/author/date), tap-to-star favorites, <4-star rows visible to the owner but grayed with "hidden from display", aggregate header ("4.9 star average, 87 reviews").
- **Curation (one rule set, applies EVERYWHERE the feed renders):** starred first -> then the rest highest-to-lowest rating (random order within the same rating is fine) -> below 4 stars never displays outside the owner's card.
- **Website:** reviews section on the academy sites (`bam-client-sites`) reading a PUBLIC portal API (same CORS-via-`clients.allowed_domains` pattern as the other website endpoints, e.g. `api/website/offer.js`). Aggregate + curated list.
- **Agents:** `renderSocialProof()` joins fact-render as the 9th fact - aggregate line + top starred/highest reviews as quotable ammo (e.g. `Parents say: "..." - Maria G., 5 star`). Wire it exactly like the other 8: add to `FACT_SOURCES`/`FACT_KEYS`, add to `derivedFactOverrides`, it auto-appears in the brain view with a LIVE badge + "Edit the brain" jump (jump target = the new Reviews card) + brain-health strip (total becomes 9; missing until Google is connected = an onboarding nudge chip).
- **Notifications: on EVERY new review; SPECIAL louder treatment for 1-star.** Use the academy's existing notification channels (study how ticket/action notifications reach owners - Slack per-client channels exist; there is an `agent_notify_phone` SMS pattern in `ghl_kpi_config`). Exact channel mix is yours to propose - the requirement is: all reviews notify, 1-star notifies UNMISSABLY.
- **OUT of this build (vNEXT, separate):** the "ask for a review" button in the conversations tab (sends the contact the academy's Google review link with a tier-2 seeded message template). Design nothing that blocks it; build none of it.
- **OUT:** auto-replying to reviews; review gating; per-academy curation-rule changes.

## Suggested shape (verify against the codebase, adjust freely)

- Tables: `google_reviews` (id, client_id, google_review_id UNIQUE per client, author_name, rating int, text, review_created_at, starred bool default false, synced_at, created_at, updated_at) + connection fields (place id / account id / refresh token) stored per client following the existing OAuth-token patterns in the repo (see `staff_meta_tokens` / GHL token handling for prior art; keep tokens out of client-readable rows - RLS!).
- Sync: a daily cron endpoint following the repo's existing `vercel.json` cron patterns; upsert on (client_id, google_review_id); reconcile deletions/edits; notification dispatch on newly-inserted rows.
- Public feed endpoint: `api/website/reviews.js` (client resolved by domain/allowed_domains, returns aggregate + curated list, never the hidden ones).
- Blueprint card: study how existing BB cards are registered/rendered in `public/client-portal.html` (search `_bbNavigate`, the offers/staff/locations cards) and how the onboarding wizard sections map (`_OBF_STEPS`/`_OBF_SECTIONS` - if you add an onboarding step for connecting Google, the step must be in BOTH registries, see the hard rule in `bam-ghl-agent/CLAUDE.md`).
- Google OAuth: mirror the repo's existing OAuth flows (`api/auth/google/*` exists for staff login - reuse patterns, NOT the same tokens). Business Profile API needs our Google Cloud project approved for the API - surface any manual console steps to Zoran early, that approval is the long pole.

## Hard rules for this repo (non-negotiable)

- NEVER an em dash in ANY person-facing output - hyphens only. Check your diffs.
- Portal UI: read `bam-ghl-agent/bam-portal/design-system/DESIGN.md` first; use its tokens; no emojis in product UI; sentence case.
- After ANY edit to `public/client-portal.html`: run `node scripts/verify-client-portal-ui.mjs` (must pass) + `npm run build`.
- V1 academies must be unaffected (gate on v2 like everything else here).
- `main` is protected: commit to a branch, PR, merge. Update `bam-ghl-agent/memories/` in the same wave (add the note + MEMORY.md line).
- Zoran is ADHD + a visual learner: short, visual updates; workshop with popups; mockup BEFORE building UI (the Reviews card + website section deserve mockups first).

## State of the world (verified 2026-07-24)

- Live academies: BAM GTA + BAM San Jose (mid-onboarding, Elijah "Lij" De Guzman) on the shared free_trial preset (master-driven routing, PR #1565); DETAIL Miami rides the master graph too.
- All 8 current facts render live; `social_proof` is the only typed leftover (its hardcoded default is a GTA Google link - your build kills it).
- The brain view has source labels + "Edit the brain" + health strip (PR #1576); per-teammate brain-edit toggle shipped (PR #1577).

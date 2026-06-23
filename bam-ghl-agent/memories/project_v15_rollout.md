---
name: V1.5 rollout — get all academies onto V1.5 (inbox + pipelines)
description: State + playbook for moving every connected academy onto V1.5 (GHL inbox + pipelines surfaced in the portal). Tools built, what's done, what remains, gotchas.
metadata:
  type: project
---

# V1.5 rollout — academies onto V1.5

Goal: get every real academy onto **V1.5** so their GHL **inbox + pipelines +
contacts** surface in the portal. (Started 2026-06-22.) This note = the
session's **infra/tools + resume playbook**; the per-academy board lives in
[[project_v15_onboarding_tracker]]. Tier details in [[project_v15_tier]] /
[[project_v2_onboarding_model]]; the V1.5 inbox in [[project_v2_sales_inbox_ui]].

## Tier model (confirmed)
- **V1** = pure GHL, portal doesn't touch them (`v2_access=false AND v15_access=false`).
- **V1.5** (`v15_access=true`) = portal READS their GHL: inbox (conversations), pipelines + stages, contacts/athlete-mapping, KPIs, Marketing + Systems nav.
- **V2** (`v2_access=true`) = V1.5 **plus** members/billing (Stripe take-over), the AI sales agent + autonomy, member import. **Only BAM GTA is V2.**

## What V1.5 needs per academy (the checklist)
1. **`v15_access=true`** — staff portal toggle.
2. **GHL connected** (`ghl_access_token`) — see connect method below.
3. **Athlete-name field mapped** — auto via the endpoint below.
4. **Owner login** — owner needs a `client_users` account to actually log in.
   (Toggle alone lets the data flow + staff to view; owner needs a login to use it.)
- ❌ NOT needed for V1.5: the "Customer replied" webhook — that's a **V2** (agent) thing.

## How academies connect GHL (the agency-mint is BLOCKED — use per-account)
- **Per-account connect (what works):** in the portal, each academy connects GHL
  via the client-portal onboarding "Connect GHL" step, OR admin shortcut
  `GET /api/messaging/connect?action=admin-start&client_id=<uuid>&key=<CRON_SECRET>`
  → GHL chooselocation → pick the matching academy → token stored. Zoran connected
  ~28 this way through his agency access.
- **Agency one-click mint is BLOCKED:** the live **FC** app (`GHL_OAUTH_CLIENT_ID`,
  id `6a1b6d41…-mpsz61td`) is **Target User = Sub-Account** (locked, published) →
  issues Location tokens → `/oauth/locationToken` rejects with "user type not yet
  supported". `agency-connect.js` was wired (uses GHL_OAUTH_CLIENT_ID + the
  registered `/api/messaging/connect` redirect + `oauth.write` scope) and authorizes
  the agency (company `90gJh9fPWfmttsG6wH6Z` = BAM's), but minting all subs needs an
  **Agency-target** app. FC2 (draft, agency-target) lacks data scopes. So agency mint
  is parked; per-account connect is the path.

## Tools built this session (all live)
- **`/api/ghl/all-pipelines`** (PUBLIC, `staff.byanymeansbusiness.com/api/ghl/all-pipelines`):
  one full-width row per connected academy → pipelines as stage→arrow→stage, plus an
  editable **notes box per pipeline that saves** (table `pipeline_notes`: client_id +
  pipeline_id, upsert on blur). `?format=json` for data. Auto-refreshes tokens, always live.
  As of build: **28 academies, 106 pipelines, 0 errors.**
- **`/api/contacts?action=auto-map-athletes`** (PUBLIC, idempotent): scans each
  `v15_access=true` academy's GHL custom fields, maps the **full-name** athlete field
  (`athlete/player/child + name/first/last/full`; prefers full-name since sync takes
  first-non-empty), writes `clients.v15_config.athlete_name_field_ids`. Skips
  already-mapped (unless `&overwrite=1`); `&dry=1` previews. **Re-run after flipping
  new academies to v15** (it only touches v15 academies).
- **App-level FC webhook → `/api/ghl/inbound-webhook`** (event `InboundMessage`, plain
  URL, no per-academy setup). **Confirmed firing + body parses** (test "yo" landed as
  type InboundMessage / SMS). Covers ALL academies for V2 reply-handling. inbound-webhook
  auth relaxed: rejects only an explicitly wrong secret; allows no-secret (app webhook).
  ⚠️ GTA still has an old per-academy Workflow "agent trigger" that DUPLICATES (sends
  body "undefined") — **delete that GTA workflow.**

## Current state (2026-06-22, end of session — BIG flip done)
- **On V1.5 (`v15_access=true`): 28 academies** (4 prior + 24 flipped this session).
  Flipped all connected V1 academies in one shot via SQL
  (`update clients set v15_access=true where ghl_access_token is not null and not v15_access and not v2_access`).
- **Athlete-name mapped: 25/28** ✅ (re-ran auto-map after the flip). The 3 unmapped
  have **no athlete-name field in their GHL yet**: Elite Smart Athletes, Fitz N Fit
  Fitness, GAME Winner Athletics (GAME Winner buildout still in progress). They map
  automatically once a field exists — re-run auto-map then.
- **Prime By Design** athlete map cleaned: auto-map had grabbed a junk survey-question
  field (`YFsCCMb489A48P0YMANi`, 0 contacts) alongside the real one; reset to just the
  good field (`KgrM7fyIm1bUWHiVccYj`, "Athlete's Full Name", 122 contacts).
- **Owner logins:** all 28 already have ≥2 `client_users` accounts → no invites needed.
- **all-pipelines spot-check:** 27/29 render pipelines; only Fitz N Fit (0) + GAME Winner
  (0) empty (buildouts not done — expected).
- Only **BAM GTA** is V2.

## Still V1 — need GHL connect first (3 real academies, not yet connected)
`ACTIV8 · Performance Space Hoops · Straight Buckets Performance` — have a GHL location
but no OAuth token. Connect via the portal "Connect GHL" step (the response_type bug that
blocked this is now FIXED — see gotchas), then flip + auto-map.

## Roster cleanup (2026-06-22)
- The old "EXCLUDED (not training)" list was WRONG — Zoran confirmed BTG, Defy The Odds,
  Fitz N Fit Fitness, Out Work, Prime By Design are all **real academies** (now V1.5).
- Real-but-no-GHL-account-yet: True Focus, Locked In Sports, Pro Precision.
- Junk/test/shell (no GHL location): Test biz (x2), test business, Demo Academy,
  MIKEEEEEE, Twin Hoops (dupe of Twin Hoops Academy), BAM Business: Internal Ads,
  BAM Coaches, Quicksand Mindset (confirmed not a real client), Basketball+ → now connected.

## REMAINING — pick up here
1. **Connect the 3 unconnected academies** (ACTIV8, Performance Space Hoops, Straight
   Buckets), then flip + re-run auto-map.
2. **3 missing athlete fields** — Elite Smart Athletes, Fitz N Fit, GAME Winner: build the
   GHL field, then re-run `auto-map-athletes`.
3. **Elevate Hoops** — its systems buildout was cancelled; pipeline shows 1, verify it's
   real before relying on it.
4. **Delete GTA's old per-academy "agent trigger" Workflow** (duplicates inbound, sends
   body "undefined") — app-level webhook already covers it.

## Gotchas
- **Deploy race:** bam-portal production lags/flaps — other sessions' deploys clobber it
  with older builds. After merging, FORCE a deploy (trivial bam-portal commit via PR) +
  POLL the live URL until the change shows (don't trust the merge alone). See
  [[project_bam_portal_deploy]].
- Per-academy connect: in the GHL chooselocation picker, **pick the matching academy** —
  wrong pick maps the wrong GHL account (the name cross-check on the pipelines page catches it).
- **GHL connect `["response_type must be a valid enum value"]` error (FIXED 2026-06-22, PR #671):**
  a refactor of `api/messaging/connect.js` dropped `response_type: "code"` from BOTH authorize
  URL builders (`handleAdminStart` + `handlePrepare`). The chooselocation page loads but
  errors on location-select; no new academy could connect. If it recurs, check both
  `URLSearchParams` blocks still include `response_type: "code"` as the first param, then
  force a prod deploy from repo root (`vercel deploy --prod`).
- No local Vercel env creds — DB/token work goes through the Supabase MCP or server endpoints.

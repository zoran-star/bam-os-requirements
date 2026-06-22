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

## Current state (2026-06-22)
- Connected GHL: ~28 academies (the all-pipelines report shows them).
- **On V1.5 (`v15_access=true`): only 4** — By Any Means Basketball, CH3 Training,
  D.A. Hoops Academy, DETAIL Miami. Athlete-name auto-mapped for these ✅.
- The other ~24 connected academies are still **V1** (GHL connected, not flipped).

## REMAINING — pick up here
1. **Flip the real connected academies to `v15_access=true`** in the staff portal.
   SKIP junk/test rows: Test biz (x2), test business, Demo Academy, MIKEEEEEE,
   BAM Coaches, BAM Business: Internal Ads, Locked In Sports/Pro Precision (unless real).
2. **Re-run** `staff.byanymeansbusiness.com/api/contacts?action=auto-map-athletes`
   (dry=1 first to preview) so the newly-flipped academies get their athlete-name field.
3. **Owner logins** — ensure each academy owner has a `client_users` account (invite) so
   they can log in. See [[project_multi_user_portal.md]].
4. Spot-check the all-pipelines page reflects everyone.

## Gotchas
- **Deploy race:** bam-portal production lags/flaps — other sessions' deploys clobber it
  with older builds. After merging, FORCE a deploy (trivial bam-portal commit via PR) +
  POLL the live URL until the change shows (don't trust the merge alone). See
  [[project_bam_portal_deploy]].
- Per-academy connect: in the GHL chooselocation picker, **pick the matching academy** —
  wrong pick maps the wrong GHL account (the name cross-check on the pipelines page catches it).
- No local Vercel env creds — DB/token work goes through the Supabase MCP or server endpoints.

---
name: Meta Marketing API integration
description: Real Meta campaigns wired into the BAM portal via HYBRID OAuth — either a BAM staff token (shared across all clients) OR the client's own connected Meta token. Plus sample-data fallback when neither is wired so the Marketing tab is demo-able.
type: project
---

## TL;DR — hybrid as of 2026-05-16

The Meta integration supports BOTH:

1. **Staff-side token** (primary path for existing managed clients). A BAM staff member with admin or marketing role connects their personal Meta once. That one token queries campaigns + ad creatives for every client whose ad account they have access to.
2. **Client-side OAuth** (optional for self-serve signups via `/onboarding.html`). The client clicks "Connect Meta" on their portal, OAuths their own account, and picks one of their ad accounts. Their token is preferred over the staff token when both exist.

`handleMetaCampaigns` looks up `client_meta_tokens` for the target client FIRST, falls back to `getAnyStaffMetaToken()` second. The frontend handles `reason: 'no_ad_account'` (with `meta_connected: true|false`) by showing 4 sample demo campaigns + a "Connect Meta" or "Pick ad account" CTA.

**Architecture history:** client-side OAuth → pivoted to staff-side in `b59cea3` (2026-05-14) → reintroduced as optional alongside staff-side in `f28f31e` (2026-05-16) so testers landing on the public onboarding URL see a populated Marketing tab.

## Database

- `staff_meta_tokens` — active. Schema: id, staff_user_id (UNIQUE FK → auth.users), fb_user_id, fb_user_name, access_token, expires_at, scopes[], timestamps. Any staff token can query any client's ad account.
- `client_meta_tokens` — also active (revived 2026-05-16). Same schema scoped to client_id. Set when client OAuths via `/api/auth/meta/start` from their portal. Preferred over staff token in `handleMetaCampaigns` when both exist.
- `clients.meta_ad_account_id` — text, nullable. Required for real campaigns. Settable by staff (via Client Setup) OR by the client themselves (via the native-prompt picker after connecting their own Meta).
- `clients.meta_campaign_ids` — array, filters which campaigns surface on the client portal (so clients don't see staff's experimental campaigns).

## OAuth scopes

`META_OAUTH_SCOPES` (api/marketing.js): `ads_read`, **`ads_management`**, **`business_management`**, `public_profile`. Write scopes added 2026-06-06 (PR #105) for the upcoming upload→creative→ad-create build. ⚠️ Requires `ads_management` + `business_management` granted on the Meta app (Standard Access, no App Review under staff-token model) AND staff must **reconnect Meta** after deploy for the existing read-only token to gain write perms.

## Access model — WHY the staff-token model stays at Standard Access (no App Review)

Verified against Meta docs 2026-06-06. The "staff token at Standard Access, no App Review" approach is valid **only because** of two conditions — if either breaks, write/read silently returns nothing or 403s:

1. **The token user must have an APP ROLE** (Admin/Developer/Tester) on app `2059912628202822`. Meta: *"the assets you can access under Standard Access are limited to those owned by **admins, developers, and testers of your app**."* A staff member who only OAuth'd through the portal but is NOT in App Roles will only see their own owned assets.
2. **That user must be granted Admin/Advertiser** on each client's ad account + Page + IG (via Leadsie/Business Manager partner share). Meta: ads_management covers accounts *"owned, or has been granted access to, by the account owner"* — so granted access counts; you don't need to OWN them.

Standard Access explicitly supports agency multi-client use (~25–50 client accounts) → **no App Review / Business Verification needed** as long as it's ONE app-team member's token over shared accounts. Advanced Access + App Review is only required for the *other* model: arbitrary third-party businesses' own users authenticating through our app (client-side OAuth at scale).

⚠️ **Robustness gap — personal token vs System User:** the live token is **Ximena's personal** long-lived token (60-day expiry, no auto-refresh — breaks if she resets pw / loses asset access / leaves). Best practice for agency server-to-server = a **non-expiring System User token** in BAM's Business Manager with client assets shared to BAM's business. Migrating to a System User is the hardening step before staff rely on ad-create daily. See the `/meta-write-access` skill for the step-by-step. Open Loop candidate.

## Env vars (Vercel `bam-portal` production)

- `META_APP_ID = 2059912628202822` (public)
- `META_APP_SECRET = encrypted`
- `META_OAUTH_STATE_SECRET = encrypted` (HMAC state signing)
- `MARKETING_ALERTS_SLACK_CHANNEL` — Slack channel id the token watchdog (+ marketing digest) posts to. If unset, the watchdog runs but stays silent.

## Token health watchdog (2026-06-14)

A daily Vercel cron `GET /api/marketing?resource=meta-health-cron` (13:00 UTC,
auth = `Bearer CRON_SECRET`) live-probes the shared token. If it's broken/missing
it posts a Slack alert to `MARKETING_ALERTS_SLACK_CHANNEL` with the reason and
raises a Sentry event (`captureApiMessage`, tag `area=meta`). Built because a
revoked/expired token otherwise blanks every ad dashboard silently. **Detection
only — does NOT auto-refresh.** Durable fix is still a non-expiring BM System
User token (see `/meta-write-access`). Reuses `probeMetaToken` (same probe as
`meta-staff-status`).

## Endpoints (all bundled in `api/marketing.js`)

Clean URLs via `vercel.json` rewrites:

**Staff-side (active):**
- `POST /api/marketing?resource=meta-staff-auth&step=prepare` — staff initiates OAuth
- `GET  /api/auth/meta/callback` — Meta returns here; upsert into `staff_meta_tokens`
- `GET  /api/marketing?resource=meta-staff-status` — is staff connected? **Now LIVE-validates** the token (probes `/me/adaccounts`), not just row presence. Returns `connected`/`team_connected` = token actually WORKS, plus `own_present`/`team_present` (a row exists) and `own_reason`/`team_reason` (`ok`|`expired`|`revoked`|`no_permission`|`no_ad_accounts`|`error`|`none`). Fixed 2026-06-14 — before this, a revoked/expired token still showed a green "connected" dot while the ad-account dropdown said "Meta not connected". Settings UI shows an amber "needs attention / reconnect" state with the reason.
- `GET  /api/meta/adaccounts` — list ad accounts the connected staff has access to
- `POST /api/meta/adaccounts` — staff picks an ad account for a client (writes `clients.meta_ad_account_id` + `clients.meta_campaign_ids`)
- `GET  /api/meta/campaigns?client_id=...` — real campaigns + insights, last 30d
- `GET  /api/marketing?resource=meta-report&client_id=...&months=<n>` — per-campaign, per-month KPI report (leads/CPL/spend/reach/impressions/link clicks/LP views/CTR/frequency) powering the **Ad Performance dashboard**. See [[project_ad_performance_dashboard]].
- `GET  /api/meta/campaigns?client_id=...&staff_picker=1` — staff-only mode that bypasses `meta_campaign_ids` filter (for picking which campaigns to surface)
- `GET  /api/marketing?resource=meta-creatives&campaign_id=...` — real ad creatives for a campaign

**Client-side (active again as of 2026-05-16):**
- `POST /api/auth/meta/start&step=prepare` — auth'd client kicks off OAuth, gets back a Facebook OAuth URL
- `GET  /api/auth/meta/callback&step=callback` — Meta returns here; upserts into `client_meta_tokens`, redirects to `/client-portal.html?meta=connected|error`
- `GET  /api/meta/adaccounts` — when called as client, lists ad accounts on THEIR token (was staff-only; opened to clients in `f28f31e`)
- `POST /api/meta/adaccounts` — when called as client, scopes to `ctx.client.id` (ignores body.client_id, no need to pass it)

## UI surfaces

- **Staff portal → Client Setup page** (`src/views/ClientSetupView.jsx`) — bulk-wire all 13 clients with their ad accounts + invite client portal users. Replaces manual SQL.
- **Staff portal → MarketingView** — campaign cards, creative grid, Facebook preview links.
- **Client portal → Marketing tab** — active campaign cards with real Meta data; creative tiles open Facebook for the post.

## What works end-to-end

- ✅ Staff Meta OAuth + shared token across all marketing/admin staff (verified 2026-05-14)
- ✅ Client-side Meta OAuth alongside staff-side; client token preferred when both exist (added 2026-05-16, untested end-to-end with a real client)
- ✅ Client Setup bulk wire-up
- ✅ Real ACTIVE-only Meta campaigns on client portal
- ✅ Real ad creatives in campaign detail (image + video + carousel)
- ✅ Facebook preview links (canonical `/pageId/posts/postId` for image/carousel; direct `open on Facebook` for video)
- ✅ Privacy-locked carousel graceful handling
- ✅ Sample-data fallback when no Meta wired — 4 demo campaign cards + "Connect Meta" CTA so /onboarding.html testers see a populated Marketing tab

## What's left

1. **End-to-end test of client-side OAuth** — added in `f28f31e` but never run with a non-staff Meta account (Meta still in dev mode, so testers must be added as Meta app developers/testers).
2. **Polish ad-account picker** — currently a native `prompt()` listing `1. Account A (act_...)` etc. Works but ugly. Upgrade to a real modal.
3. **Token refresh on Meta 401** — 60-day long-lived token has no auto-refresh. If it expires/revokes, campaigns endpoint 401s silently. Need a "Reconnect Meta" CTA when this happens.
4. **App Review submission** — currently in Meta Development mode. Required before non-tester Meta users can complete the client-side OAuth.

## Lessons (from end-to-end testing)

1. Run `node --check` on edited files BEFORE pushing — duplicate `const` declarations in clients.js caused multiple FUNCTION_INVOCATION_FAILED rounds (commits 66b1a15, 8d89551).
2. `require()` in ESM module breaks Vercel. Use `import crypto from "node:crypto"` (commit 9d85628).
3. `echo "value" | vercel env add` stores a trailing `\n`. Use `printf` instead. See `feedback_vercel_env_no_newline.md`.
4. Don't blindly upscale Meta CDN URLs — they're signed and reject modified params (commit b573dd1).

## Related notes

- [[project_marketing_content_flow]] — marketing/content ticket flow that consumes Meta campaign data
- [[project_pre_launch_checklist]] — pre-launch items including Meta token refresh

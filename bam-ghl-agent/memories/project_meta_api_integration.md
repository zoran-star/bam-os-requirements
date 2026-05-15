---
name: Meta Marketing API integration
description: Real Meta campaigns wired into bam-portal-tawny via staff-side OAuth (one BAM staff token powers every client's campaigns).
type: project
---

## TL;DR

**Staff-side OAuth.** A BAM staff member (admin or marketing role) connects their Meta account once. That single token is used to query campaigns + ad creatives for every client whose ad account the staff has access to. Clients themselves never touch Meta.

**Pivoted away from client-side OAuth** in commit `b59cea3` (2026-05-14). The earlier design (each academy connects their own Meta) was scrapped because Meta App Review is a hard blocker for non-developer users, and BAM staff already have access to client ad accounts. One staff token = all clients = no per-client onboarding friction.

## Database

- `staff_meta_tokens` — primary. Schema: id, staff_user_id (UNIQUE FK → auth.users), fb_user_id, fb_user_name, access_token, expires_at, scopes[], timestamps. Any staff token can query any client's ad account (shared across admin/marketing roles).
- `client_meta_tokens` — legacy from the client-side OAuth attempt. Code references remain in `api/marketing.js` (lines 844, 970) but are no longer the active flow. Safe to ignore.
- `clients.meta_ad_account_id` — text, nullable. Set by staff via Client Setup page; required for `/api/meta/campaigns` to return real data.
- `clients.meta_campaign_ids` — array, filters which campaigns surface on the client portal (so clients don't see staff's experimental campaigns).

## Env vars (Vercel `bam-portal` production)

- `META_APP_ID = 2059912628202822` (public)
- `META_APP_SECRET = encrypted`
- `META_OAUTH_STATE_SECRET = encrypted` (HMAC state signing)

## Endpoints (all bundled in `api/marketing.js`)

Clean URLs via `vercel.json` rewrites:

**Staff-side (active):**
- `POST /api/marketing?resource=meta-staff-auth&step=prepare` — staff initiates OAuth
- `GET  /api/auth/meta/callback` — Meta returns here; upsert into `staff_meta_tokens`
- `GET  /api/marketing?resource=meta-staff-status` — is staff connected?
- `GET  /api/meta/adaccounts` — list ad accounts the connected staff has access to
- `POST /api/meta/adaccounts` — staff picks an ad account for a client (writes `clients.meta_ad_account_id` + `clients.meta_campaign_ids`)
- `GET  /api/meta/campaigns?client_id=...` — real campaigns + insights, last 30d
- `GET  /api/meta/campaigns?client_id=...&staff_picker=1` — staff-only mode that bypasses `meta_campaign_ids` filter (for picking which campaigns to surface)
- `GET  /api/marketing?resource=meta-creatives&campaign_id=...` — real ad creatives for a campaign

**Client-side (legacy, code retained but flow inactive):**
- `POST /api/auth/meta/start`, `GET /api/auth/meta/callback` for `client_meta_tokens`

## UI surfaces

- **Staff portal → Client Setup page** (`src/views/ClientSetupView.jsx`) — bulk-wire all 13 clients with their ad accounts + invite client portal users. Replaces manual SQL.
- **Staff portal → MarketingView** — campaign cards, creative grid, Facebook preview links.
- **Client portal → Marketing tab** — active campaign cards with real Meta data; creative tiles open Facebook for the post.

## What works end-to-end (verified 2026-05-14, expanded 2026-05-15)

- ✅ Staff Meta OAuth + shared token across all marketing/admin staff
- ✅ Client Setup bulk wire-up
- ✅ Real ACTIVE-only Meta campaigns on client portal
- ✅ Real ad creatives in campaign detail (image + video + carousel)
- ✅ Facebook preview links (canonical `/pageId/posts/postId` for image/carousel; direct `open on Facebook` for video)
- ✅ Privacy-locked carousel graceful handling

## What's left

1. **Token refresh on Meta 401** — 60-day long-lived token has no auto-refresh. If it expires/revokes, campaigns endpoint 401s silently. Need a "Reconnect Meta" CTA when this happens.
2. **App Review submission** — currently in Meta Development mode. Required only if non-BAM-staff Meta users will ever connect. Today: not needed (staff-only flow).
3. **Cleanup legacy `client_meta_tokens` code paths** — references in marketing.js are dead code. Low priority but worth removing for clarity.

## Lessons (from end-to-end testing)

1. Run `node --check` on edited files BEFORE pushing — duplicate `const` declarations in clients.js caused multiple FUNCTION_INVOCATION_FAILED rounds (commits 66b1a15, 8d89551).
2. `require()` in ESM module breaks Vercel. Use `import crypto from "node:crypto"` (commit 9d85628).
3. `echo "value" | vercel env add` stores a trailing `\n`. Use `printf` instead. See `feedback_vercel_env_no_newline.md`.
4. Don't blindly upscale Meta CDN URLs — they're signed and reject modified params (commit b573dd1).

## Related notes

- [[project_marketing_content_flow]] — marketing/content ticket flow that consumes Meta campaign data
- [[project_pre_launch_checklist]] — pre-launch items including Meta token refresh

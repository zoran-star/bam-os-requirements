---
name: Meta Marketing API integration
description: Architecture + state for the real Meta campaigns integration in bam-portal-tawny. Client-side OAuth (each academy connects their own ad account).
type: project
---

## TL;DR

Each academy (client) connects their own Meta ad account. Tokens stored per client in `client_meta_tokens`. Replaces hardcoded "Title of campaign 1" fake cards with real data.

## Database

- `client_meta_tokens` — created 2026-05-13. Schema: id, client_id (UNIQUE FK → clients), fb_user_id, fb_user_name, access_token, expires_at, scopes[], timestamps. RLS: client reads own row.
- `clients.meta_ad_account_id` — text, nullable. **Not yet added** as of this note. Required before `/api/meta/campaigns` will succeed.

## Env vars (Vercel `bam-portal` production)

- `META_APP_ID = 2059912628202822` (public)
- `META_APP_SECRET = encrypted` (set via CLI)
- `META_OAUTH_STATE_SECRET = encrypted` (random 32 bytes for HMAC state signing)

## Endpoints (bundled in `api/marketing.js` to stay under 12-fn Hobby cap)

Clean URLs via `vercel.json` rewrites:
- `POST /api/auth/meta/start` — auth'd client, returns Facebook OAuth URL with signed state
- `GET /api/auth/meta/callback` — Facebook returns here; we exchange code → short token → 60-day long-lived token; upsert into `client_meta_tokens`; redirect to `/client-portal.html?meta=connected|error`
- `GET /api/meta/adaccounts` — lists FB ad accounts the connected client has access to (for the ad-account picker)
- `GET /api/meta/campaigns` — real campaigns + insights for the client's ad account (last 30d). Returns `{ campaigns: [], reason }` when not wired

OAuth state: HMAC-SHA256, 5-min expiry, nonce. Verified with `timingSafeEqual`.

## Meta dashboard (Zoran's manual steps)

| Step | Status |
|---|---|
| Create Meta Developer App (Business type) | ✅ |
| Add Marketing API use case | ✅ |
| Paste App ID + Secret to Vercel | ✅ via CLI |
| Add Facebook Login product to app | ❌ pending |
| Add Valid OAuth Redirect URI: `https://bam-portal-tawny.vercel.app/api/auth/meta/callback` | ❌ pending |
| Add Mike + Coleman as app developers | ⏳ optional |

App stays in Development mode (no review needed) for BAM staff testing. Review required only when non-staff Meta users connect.

## What's done in code

Through commit `313f9e6`:
- `api/marketing.js` — handleMetaAuth (prepare + callback), handleMetaAdAccounts (GET list / POST pick / DELETE unset), handleMetaCampaigns
- `vercel.json` — rewrites for clean Meta URLs
- `clients.meta_ad_account_id` column added (migration `add_meta_ad_account_id_to_clients`)
- `public/client-portal.html` — Marketing tab Active Campaigns section is now dynamic with 4 states (not connected / no ad account / empty campaigns / has campaigns). Connect Meta CTA, ad-account picker, real campaign cards. OAuth callback toast on page load (`?meta=connected|error`).

## What's left (post-2026-05-14 end-to-end test)

**FULL FLOW WORKS:** Zoran successfully onboarded BAM GTA from scratch on 2026-05-14, set password, OAuth'd Meta, picked ad account, saw real campaigns in the Marketing tab. Phase 7 complete.

Remaining (out of scope for this goal, follow-up tasks):
1. **Staff invite backend** — UI exists in `StaffModals.jsx` but POSTs to non-existent `/api/staff`. Wire a real handler (bundle into marketing.js as `?resource=staff-invite` or fold into clients.js as `?action=invite-staff`). Different `redirect_to` from client invite (root, not /client-portal.html).
2. **Campaign DETAIL creative grid** still hardcoded to 8 Picsum images. Wire to Meta `/adcreatives` for real ad creatives. ~1hr.
3. **Token refresh on 401** — today the 60-day long-lived token has no auto-refresh. If it expires (or is revoked), campaigns endpoint will 401 silently. Surface a "Reconnect Meta" CTA on the Marketing tab when this happens.
4. **App Review submission** — for non-developer Meta users to be able to connect, the BAMPORTAL Meta app needs ads_read approved via Meta's App Review. Currently in Development mode (only BAM staff + invited testers can use it). When ready to expand, submit.

## Bugs found + fixed during the end-to-end test (2026-05-14)

Documented here so they don't recur:

1. **/api/clients 'auth required'** — public onboarding form was blocked by admin-only auth check. Fix: added public signup path detection in clients.js (commit 3b1ea4a).
2. **`const action` duplicate declaration** in clients.js — caused FUNCTION_INVOCATION_FAILED. Fix: renamed to publicSignupAction (commit 66b1a15).
3. **`const body` duplicate declaration** in clients.js — same issue, second variable. Fix: renamed to signupBody (commit 8d89551). Lesson: run `node --check` on edited files BEFORE pushing.
4. **Invite redirect went to staff portal** — Supabase Site URL was `/` (staff portal). Two-part fix: (a) Zoran changed Supabase Site URL to `/client-portal.html`, (b) added defensive redirect in App.jsx that bounces client users to /client-portal.html (commit 196ba8c).
5. **`require("crypto")` in ESM module** — marketing.js is `export default` ESM but I added `const crypto = require(...)` which is CJS. Caused 500 on every /api/marketing call. Fix: moved to top-of-file `import crypto from "node:crypto"` (commit 9d85628).
6. **vercel.json rewrite step=start vs handler step=prepare** — wizard hit /api/auth/meta/start which routed but the step param didn't match handler's expected value. Fix: changed rewrite to step=prepare (commit 37a9107).
7. **Vercel env vars stored with trailing \n** — `echo "value" | vercel env add` appended a newline that became part of the stored value. Facebook OAuth rejected "Invalid App ID" because client_id had %0A appended. Fix: removed + re-added all 3 META_* env vars using `printf` instead of `echo`. Lesson saved as feedback memory.

## Why client-side (not staff-side)

Earlier draft built `staff_meta_tokens` (BAM staff connect once, query many academies). Dropped after Zoran clarified the pattern: **each academy owns their Meta connection**. Reasons: clean ownership, no staff lock-in, transferable when academy changes hands, scales without depending on BAM staff being added to each ad account.

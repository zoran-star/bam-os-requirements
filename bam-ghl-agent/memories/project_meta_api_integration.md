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

- `api/marketing.js` — handleMetaAuth (prepare + callback), handleMetaAdAccounts, handleMetaCampaigns
- `vercel.json` — rewrites for clean Meta URLs

Code references `clients.meta_ad_account_id` which doesn't exist yet — the campaigns endpoint will return `{ campaigns: [], reason: "no_ad_account" }` until the column lands.

## What's left

1. Add `clients.meta_ad_account_id` column (DDL, needs approval).
2. Build "Connect Meta" button on client portal (Marketing tab).
3. Add "Connect Meta" step to `/onboarding.html` (after password-set).
4. Build ad-account picker UI (calls `/api/meta/adaccounts`, saves to `clients.meta_ad_account_id`).
5. Replace hardcoded "Title of campaign 1/2" cards with fetch from `/api/meta/campaigns` + zero state.
6. BAM GTA re-onboards as the end-to-end test client.

## Why client-side (not staff-side)

Earlier draft built `staff_meta_tokens` (BAM staff connect once, query many academies). Dropped after Zoran clarified the pattern: **each academy owns their Meta connection**. Reasons: clean ownership, no staff lock-in, transferable when academy changes hands, scales without depending on BAM staff being added to each ad account.

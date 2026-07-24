# GHL location tokens - how they stay warm (and how they went cold)

**Status:** code shipped 2026-07-23. **One manual step still outstanding** - see "What Zoran must do".

## The model

BAM is the **agency** (`company_id 90gJh9fPWfmttsG6wH6Z`). It authorizes GHL **once** at
company level. Every academy sub-account's token is **minted from that agency token** via
`/oauth/locationToken` and written to `clients.ghl_access_token`. Academies never do their
own OAuth.

```
ghl_agency_tokens (Company token)
        |
        |  /oauth/locationToken   (needs oauth.write + an AGENCY-distribution app)
        v
clients.ghl_access_token  (per academy, 24h TTL)
```

## What actually broke (incident, found 2026-07-23)

The row in `ghl_agency_tokens` was a **Location token for BAM GTA**
(`authClass: "Location"`, `authClassId: Le9phlhqKyjLyd0JTECv`), not a Company token.

You cannot mint location tokens from a location token. So the nightly re-mint cron had been
answering **HTTP 200 with `connected: 0/33`** every day for weeks, error
`"This token's user type is not yet supported!"`, with no alert.

Two things let that happen:
1. `agencyConnectFromCode` only checked "did a companyId come back". **GHL returns a
   companyId even for a single-location install**, so a Location token was accepted and stored.
2. `agency-connect.js` used `GHL_OAUTH_CLIENT_ID` (the **sub-account** app). A dedicated
   `GHL_AGENCY_OAUTH_CLIENT_ID` existed in Vercel env but was referenced nowhere in code.

With minting dead, the only thing renewing tokens was `pickGhlToken`, which renewed **only
inside a 60-second window** before expiry and swallowed failures with `catch (_) {}`. That is
**one attempt per 24h cycle**. Miss it once and the academy is bricked, because GHL
refresh tokens are single-use and the stored one is then dead forever (verified: BAM NY's
returns `invalid_grant`). Academies died one at a time from 2026-06-27 onward; **14 of 30
were cold** when this was found. The only known "fix" was a human opening that client's
Inbox to force an on-demand refresh.

**Note:** the original diagnosis blamed a `v15_access` gate in `cron-sync-contacts`. That was
wrong. That cron selects **all** GHL-connected clients; the `v15_access` check only gates the
`ghl_contacts` mirror for the Contacts tab. `cron-sync-pipeline` is a portal-to-GHL mirror job
and is correctly scoped to `pipeline_provider='portal'`.

## What is in place now

| Piece | Where |
|---|---|
| Shared agency plumbing: `getAgencyToken`, `mintForClient`, `mintAll`, alerting | `api/ghl/_agency.js` |
| `RENEW_WINDOW_MS = 6h` (was 60s) - the single source for every renew window | `api/ghl/_agency.js` |
| Rejects storing any token whose `authClass !== "Company"` | `assertCompanyToken` |
| Uses `GHL_AGENCY_OAUTH_CLIENT_ID` when set, falls back to `GHL_OAUTH_CLIENT_ID` | `agencyCreds()` |
| Hourly stale re-mint `?action=mint&scope=stale` at `20 * * * *`; daily full mint at `0 4 * * *` | `vercel.json` |
| `pickGhlToken` renews **mint-first, refresh-second** and re-reads the row if a concurrent process consumed the refresh token | `api/ghl/_core.js` |
| Slack alert on any mint failure; a 100% failure rate says "the agency token itself is broken" | `alertOnMintResults` |
| `clients.ghl_token_error` / `ghl_token_error_at` flag a client needing reconnect | migration `20260723020000` |
| `/api/agency-connect` landing page is a live health check | `agency-connect.js` |

**Token renewal now lives in ONE place.** 11 files had their own copy of
`refreshGhlToken`/`pickGhlToken`, each with the same 60s race - including
`cron-sync-contacts.js`, the job that actually keeps tokens warm. They all now import from
`api/ghl/_core.js`. `api/website/availability.js` keeps its own `getClientGhlToken` because it
returns a **bare token string**, not `{token, locationId}`; only its window was widened.

## What Zoran must do (still outstanding)

The code cannot heal the 14 cold academies on its own - their refresh tokens are dead and
the stored agency token still cannot mint. **Someone has to re-run the agency OAuth once:**

1. Open `https://portal.byanymeansbusiness.com/api/agency-connect` - it now reports the
   token's health directly.
2. Click `?action=start`.
3. On the GHL consent screen choose the **agency / company**, not a single sub-account.
4. The callback mints for all 33 academies and prints a pass/fail table.

If it still refuses, the marketplace app `6a35473cf0df01a626a9416c` needs
**Distribution = Agency** and the redirect URL registered. A Location token can no longer be
stored by mistake - `assertCompanyToken` now blocks it with a fix-it message.

## Gotchas

- `oauth.write` **and** `oauth.readonly` must be in the agency scope set or minting fails.
- GHL refresh tokens are **single-use and bound to the issuing OAuth app**. Never rely on the
  refresh grant as the primary path; mint from the agency token instead.
- A location token's TTL is 24h, so anything that only renews seconds before expiry has
  exactly one chance per day. Use `RENEW_WINDOW_MS`.
- `clients.ghl_connect_status` has a CHECK constraint
  (`not_connected|onboarding|connected|disabled`). Do not invent new values - use
  `ghl_token_error` instead.
- Three academies (Pro Precision, Elevate Hoops, Major Hoops) carry a sentinel expiry of
  `2099-01-01` and no refresh token. They are intentionally outside the stale sweep.

Related: [[project_v15_rollout]], [[project_calendars_offghl]]

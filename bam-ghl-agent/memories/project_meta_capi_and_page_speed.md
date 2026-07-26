# Meta CAPI + the page-speed measurement fix

**2026-07-25.** Started from BAM GTA's free-trial funnel card reading **212 clicked -> 84 loaded (40%)** and ended in three places. Read this before touching the funnel card, `funnel_events.meta`, or anything Meta-pixel shaped.

## What the funnel card's steps actually are

`_mmRenderLandingFocus` in `public/client-portal.html`:

| Step | Source |
|---|---|
| CLICKED | Meta `inline_link_clicks` (`page.clicks_comparable`) |
| LOADED | **Meta `landing_page_view`** (`page.lpv_comparable`) |
| FORM / CALENDAR / BOOKED | our own `funnel_events` beacons |

So CLICKED -> LOADED is **not** our data. It measures whether Meta's browser pixel reported, and the pixel is blocked or fails for a large share of mobile ad traffic. Our first-party beacon recorded **173 distinct fbclids** over the same 14 days vs Meta's 84, i.e. ~82% of clicks really did load. Do not read that step as a page-quality signal on its own.

## Root cause on the site side (fixed in bam-client-sites)

Client sites shipped `@babel/standalone` (3.1 MB) from unpkg and compiled JSX in the browser, so the pixel could not fire until the app booted: ~1.85 s on a warm-cache desktop, multiples of that on mobile. Fixed by `scripts/site-compile.mjs` in **bam-client-sites** (PR #116): JSX compiled at deploy, React self-hosted, pixel inlined into `<head>` from `client.json` `tracking.meta_pixels`.

## Conversions API (this repo)

- `api/_meta-capi.js` - `sendMetaEvent(client, {...})`, plus `requestContext(req)` and `fbcFromClick(fbc, fbclid)`. Hashes em/ph/fn/ln per Meta's normalisation, token goes in the **body** not the URL, 2.5 s timeout, never throws.
- Wired into `api/website/funnel-event.ts` (**PageView**, on `step === 'page_view'`) and `api/website/leads.js` (**Lead**, right after the `website_leads` row is saved so it fires on every success path).
- **Dedup is the whole trick:** the browser pixel and the server event carry the same `event_id`, so Meta counts one. The site sends `event_id` + `_fbp`/`_fbc`; on a first page view `_fbc` may not exist yet, so `fbcFromClick` rebuilds it from the `fbclid` we captured.
- Config is per client in **`clients.meta_capi`** (jsonb, added 2026-07-25):
  ```json
  { "pixels": [{ "id": "<pixel id>", "token": "<CAPI token>" }], "test_event_code": "TEST123" }
  ```
  **NULL = disabled**, which is the state every client is in until someone pastes a token from Events Manager > Settings > Conversions API. Nothing breaks while it is null.
- ⚠️ `leads.js` selects `meta_capi`, so the column must exist before that code deploys. It was applied directly (additive `add column if not exists`); the migration file `20260725210000_clients_meta_capi.sql` is idempotent and safe to replay.

## The load chip was lying (fixed)

`funnel_events.meta.load_ms` is `navigation.loadEventEnd`, which on a client-rendered page fires **while the screen is still blank** - it covers the HTML and its script tags, not booting the app. GTA's chip read ~1.0 s while real content took seconds.

The beacon now also sends **`render_ms`**, stamped when the page component first commits. `api/marketing.js` `loadPerf` headlines `render_ms` when it has 3+ samples and reports `basis: 'render' | 'load'`; `_mmLoadChip` says which one it is and surfaces the `render - load` gap as "app boot +Xs" when it exceeds 500 ms. **Never headline `load_ms` again for a client-rendered page.**

## GTA's live Meta config (verified 2026-07-26 via the Marketing API)

Ad account `act_945289010672617` has two pixels attached: `1142940663626761` ("CRM BAM Toronto", never fired) and **`1692167884521071`** ("Form Fills BAM Toronto", the live one). The single ACTIVE ad set optimises `OFFSITE_CONVERSIONS` on `1692167884521071` with **`custom_event_type: SCHEDULE`**.

Two things this exposed:

1. **Nothing fired `Schedule`.** `submitLead` only fired `Lead`. Meta's 28-day counts: 1402 PageView, 61 Lead, **4 Schedule**, 9 Purchase - against the ~50/week Meta wants to leave the learning phase. Fixed: `submitLead` now fires `Schedule` when `data.appointment === 'booked'`, with its own `schedule_event_id`, and `leads.js` replays it through CAPI on `appointmentStatus === "booked"`. **If you change the booking flow, keep that gate.**
2. **Pixel `854357739640091`** ("bam toronto 1") was firing from the site but is on neither the ad account nor any ad set - a pure mirror (1405 PageView / 62 Lead). Removed 2026-07-26, since `fbq` fetches a config per id serially and holds PageView until all land (~300 ms). Its owner could not be read with the staff token's permissions; if custom audiences somewhere go quiet, this is why.

**How to query this yourself:** the staff Meta token is in `staff_meta_tokens` (most-recently-updated row wins, see [[project_meta_token_selection_gotcha]]). Useful edges: `/{act}/adspixels`, `/{campaign}/adsets?fields=promoted_object`, `/{pixel}/stats?aggregation=event`. Ownership fields (`owner_ad_account`, `owner_business`) need broader permissions than the current token has.

⚠️ Gotcha: `bam-portal/.env.local` stores `VITE_SUPABASE_URL` with a literal `\n` inside the quotes, so naive `source .env.local` or `cut` parsing yields a bad hostname. Strip `\n` when parsing. See [[feedback_vercel_env_no_newline]].

## Known follow-ups

- `by-any-means` summer-academy + virtual-academy each load React dev builds + Babel (4.3 MB) for `*-tweaks.jsx` files that are not in the repo.
- Only `bam-gta` is on the new compile pipeline; `by-any-means` and `detail-miami` still deploy the old way.

Related: [[project_marketing_machine_dashboard]], [[project_meta_api_integration]], [[project_parent_funnel_live]].

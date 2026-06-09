---
name: The Pricing Sorter — onboarding wizard (price match → CSV members → cleanup)
description: A guided wizard launched from Onboarding Action Items (after Offers is done), on BOTH the staff + client portal. Step 1 visually matches offer prices to Stripe subs/products (boxes+arrows) and CREATES missing Stripe prices on approval with plain-language explanation; Step 2 imports an arbitrary client CSV → AI column mapping → confirm → populates a separate per-client members table; Step 3 cleans up connectivity issues. Decided 2026-06-09.
metadata:
  type: project
---

# The Pricing Sorter (onboarding wizard)

Extends the AI price matcher ([[project_offer_price_mapping]]) into a full guided
wizard for onboarding an academy. Launched from the **Onboarding Action Items →
after the Offers step is done → a "🔀 The Pricing Sorter" button**. Lives on BOTH
the staff portal (bam-portal/src React) AND the client portal (client-portal.html).

## The flow

```
STEP 1 — MATCH PRICES (visual: boxes + arrows)
  Left = the academy's OFFER prices (from offers.data.pricing.pricing_offerings,
  plan × term). Right = their Stripe subs/products. Draw arrows for matches.
  • Reuses the matcher engine (/api/offers/match-prices) — amount (base or all-in),
    name, interval, recency, one-time scan, Live/Legacy.
  • If an offer price has NO close Stripe match → AI recommends CREATING a Stripe
    price, EXPLAINED PLAINLY for the owner: how it bills in real life ("$226 every
    4 weeks = your $200 + 13% HST"), whether it matches the offer exactly or slightly
    changes it. On the owner's APPROVAL → the wizard CREATES the price in Stripe
    (writes to the connected account). [Decision: create-on-approval.]

STEP 2 — IMPORT MEMBERS (CSV)
  Owner uploads their OWN member spreadsheet (ARBITRARY columns). AI reads it →
  proposes a column → member-field mapping → owner CONFIRMS columns with checkmarks
  → the wizard creates + populates a SEPARATE PER-CLIENT members table with that
  client's members. [Decision: arbitrary CSV; separate per-client table — NOT the
  shared `members` table. EXACT meaning still OPEN — see below.]

STEP 3 — CLEANUP
  Fix potential connectivity issues (member ↔ Stripe customer/sub links, dupes,
  members on a price with no offer, etc.). [Exact checks OPEN.]
```

## Decisions (Zoran, 2026-06-09)

- Launch: Onboarding Action Items, after Offers ✓. Button = "The Pricing Sorter".
- BOTH portals (staff + client), built together.
- Step 1 no-match → **create the Stripe price on approval** (wizard writes to Stripe),
  with a plain-language explanation of what it makes + offer impact.
- Step 2 CSV = the academy's **own arbitrary spreadsheet** → AI column mapping →
  checkmark confirm.
- Step 2 target = a **separate per-client table** (not the shared `members` table).
- Visual style: boxes + arrows for the price match (more visual than the current
  dropdown matcher modal).

## OPEN QUESTIONS (still to confirm before building)

1. "Separate per-client table" — does this mean: (a) one literal table per client
   (e.g. members_import_<client>), (b) a single shared STAGING/raw-import table
   scoped by client_id (separate from operational `members`), or (c) actually the
   `members` table but a fresh set for a new academy? Most likely (b) a staging table
   → cleaned → promoted. NEEDS CONFIRMING.
2. Step 3 cleanup — what connectivity issues exactly (unlinked Stripe customer/sub,
   email mismatch, dupes, CoachIQ id, members on an unmatched price)?
3. GTA test data — where to store the test CSV (Supabase storage bucket?) so we can
   test the import with real GTA member data.
4. Staff vs client portal build approach — one shared page/component both embed, or
   parallel implementations (React staff + static client)?
5. Does Step 1 also write the confirmed matches to pricing_catalog (offer_price_key,
   tier) like the current matcher's apply? (Assume yes — same apply path.)

## What already exists to build on

- `/api/offers/match-prices` — the matcher (propose + apply, recency, one-time,
  Live/Legacy, one-live-per-slot). Step 1 reuses this.
- The matcher review modal in client-portal.html (offer-centric, dropdowns) — Step 1's
  boxes+arrows is a more visual version of this.
- `offers.data.pricing.pricing_offerings` — the offer prices (targets).
- `pricing_catalog` (+ offer_id/offer_price_key/coachiq_product_id/match_* columns).
- The Onboarding Action Items (where the launch button goes).
- Stripe connected-account access (platform key + Stripe-Account) for creating prices.

## GTA test fixes — 2026-06-09

- **Bug:** Step 1 (and any Sorter AI call) threw *"AI did not return a JSON array"*
  whenever Claude's output was fenced, prose-led, or truncated. Hit on GTA with 31
  live prices (4096 max_tokens truncated mid-array → no closing `]`).
- **Fix:** new shared helper **`bam-portal/api/_ai.js` → `claudeJsonArray()`** —
  bumps max_tokens, parses robustly (locates the array, repairs a truncated tail
  keeping every complete object), and on failure throws the real reason + a snippet
  (incl. `stop_reason`). Wired into all 4 callers: `offers/match-prices.js`,
  `offers/create-price.js`, `sorter/import.js`, `sorter/map-columns.js`. Use
  `claudeJsonArray` for any future JSON-array AI call.
- ⚠️ **GOTCHA — no assistant prefill on `claude-sonnet-4-6`.** First attempt forced
  array output by prefilling the assistant turn with `[`; the model 400s with *"This
  model does not support assistant message prefill. The conversation must end with a
  user message."* (the Claude 4.6/4.7/4.8 family removed prefill). Don't prefill —
  instruct via the system prompt + parse robustly. (Structured outputs via
  `output_config.format` is the documented alternative if we ever need a hard guarantee.)
- **Progress bar:** added `_sorterLoading(label)` in client-portal.html (reuses the
  `assetLoadingSlide` / `.asset-modal-loading` style) — shows an indeterminate bar on
  Step 1 price-read, Step 2 column-mapping, and Step 3 cleanup-check fetches. Step 2
  also now falls back to manual column mapping if the AI map call fails.
- ⚠️ **GOTCHA — function timeout shows as "Failed to fetch".** Once the AI call
  succeeded, `match-prices` ran long (paginates ALL Stripe subs/products/charges →
  ~38 sequential calls + the Claude call) and blew past Vercel's short default
  function timeout → the request was killed → the client showed *"Couldn't load
  prices — Failed to fetch"* (a network error, NOT an API error). Fix: added
  `export const maxDuration = 60;` to all 5 Sorter endpoints (match-prices,
  create-price, sorter/import, sorter/map-columns, sorter/cleanup). Any new
  Stripe-pagination-or-AI endpoint needs `maxDuration` too — the default is too short.

## RESOLVED — round 2 (Zoran, 2026-06-09)

- Import target = a **STAGING table** (shared, scoped by client_id), SEPARATE from the
  live `members` table. CSV lands here → cleaned in Step 3 → PROMOTED into `members`.
  So Q1 = option (b)/staging.
- Step 3 cleanup checks: (1) member ↔ Stripe link (member with no Stripe customer/sub,
  and subs with no member — match by email), (2) duplicates (same email/athlete),
  (3) members on a price with no offer (matcher's 'add it?' flag), (4) verify all
  LEGACY prices are organized properly. **IGNORE CoachIQ for this wizard.**
- GTA test CSV: exported the 54 members → `~/Downloads/gta-members.csv` (Athlete Name,
  Parent Name, Email, Phone, Plan, Status, Joined Date, Stripe Customer, Stripe Sub).

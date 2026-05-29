---
name: Onboarding Wizard — parked
description: 2026-05-29 — Ideal post-signup wizard for new academies. Parked until GHL OAuth flow is verified end-to-end for BAM GTA. Zoran wants the GHL plumbing proven first, then we revisit this for academy #2.
type: project
---

## Why this is parked

Zoran's call (2026-05-29): "I want to make sure GHL works for GTA and can
be adapted to other academies first." Wizard is the right idea for
academy #2 onward but doesn't ship value for academy #1 (BAM GTA — they're
already in, manually configured).

Order of operations:
1. ✅ GHL OAuth plumbing built (commit 4453c44)
2. ✅ Inbox + Payment Link modal built
3. ⏳ Verify GHL works end-to-end for BAM GTA
   (Zoran sets up GHL Marketplace App + env vars + clicks Connect GHL +
    runs test SMS button → phone buzzes)
4. ⏳ Then build the wizard described below for future academies.

## What the wizard should do

Goal: a new academy goes from "I have a Stripe account + a GHL location"
to "I'm using the BAM portal" in **3 steps · ~3 minutes**.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   1. SIGN UP                                          30 sec │
│      Business name · Owner email · Password                  │
│      → magic-link email confirms                              │
│                                                              │
│   2. CONNECT STRIPE                                    1 min │
│      [ Connect Stripe ↗ ]                                     │
│      OAuth → pick existing Stripe account → returns           │
│      Portal: "Found 47 active subs. Import them as members?" │
│      [ Import all 47 ]                                        │
│      ✅ Roster populated · Members tab works                   │
│                                                              │
│   3. CONNECT GHL                                       1 min │
│      [ Connect GHL ↗ ]                                        │
│      OAuth → pick GHL location → returns                      │
│      ✅ Inbox starts populating · Payment Link sends unlocked  │
│                                                              │
│   4. FIRST-LOGIN TOUR                                 30 sec │
│      Existing tour expanded to walk through Inbox + Pricing   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## What's already built (reusable)

- **Stripe Connect button**: `client-portal.html#stripe-connect-button-host`
  + `/api/stripe/connect` (OAuth flow). Already shipped in commit `0540dd7`.
- **GHL Connect button**: `client-portal.html#ghl-connect-button-host`
  + `/api/ghl/connect` (OAuth flow). Shipped in commit `4453c44`.
- **First-login tour**: `client-portal.html` `TOUR_STEPS` + `TOUR_DEMO_CONTAINERS`.
  Tour verifier at `bam-portal/scripts/verify-client-portal-ui.mjs` must keep
  passing — touch carefully.
- **Public onboarding page**: `bam-portal/public/onboarding.html`. Currently
  step 1 only (sign up). Needs the post-signup wizard appended.

## What needs building (~1.5 days)

### 1. The wizard component (~half day)
- New view in `client-portal.html` (or extend `onboarding.html`):
  `#view-setup-wizard` — slot in 4 cards, one per step.
- State machine: `'account_created' → 'stripe_connected' → 'subs_imported'
  → 'ghl_connected' → 'tour_done'`. Persist on `clients.onboarding_state`
  or reuse existing `clients.onboarding_completed_at`.
- On every portal load, check state — if not 'done', force-show the wizard.

### 2. Stripe → members import endpoint (~half day)
- New `/api/admin/import-stripe-members.js` (modeled on
  `/api/admin/backfill-stripe-joined-at.js` from this session).
- Pulls every active + trialing sub on the connected account.
- For each, creates a `members` row with status='live', plan inferred
  from `pricing_catalog` (auto-classifies price first if not present).
- Uses the customer's metadata to populate athlete_name / parent_email
  / parent_phone where available.
- Returns a summary: `{ imported: N, skipped: [...] }`.
- Idempotent — re-runs cleanly.

### 3. Tour extension (~1 hour)
- Extend `TOUR_STEPS` to include `Inbox` and `Pricing` views
  (currently just Members + Marketing + Business Blueprint).
- Add matching selectors to `TOUR_DEMO_CONTAINERS`.
- Keep `verify-client-portal-ui.mjs` passing.

## Auto-import gotcha — pricing classification first

When importing subs from Stripe during onboarding, each sub has a price ID.
For an academy that's never used the portal before:
- Their `pricing_catalog` is empty.
- The import endpoint should ALSO seed the catalog by walking the active
  Stripe products + prices on the connected account before importing
  subs.
- Auto-classify: first encountered price per amount becomes `canonical`;
  duplicates become `legacy_match`.
- Owner can re-tag later via the Pricing view (built in commit `3129388`).

## Related notes

- [[project_member_management_portal]] — main project memory; Session 4 (this
  one) covers the OAuth + Inbox + Pricing builds.
- Stripe Connect handshake: see Session 2 of project_member_management_portal
  for the live-mode setup pattern; the GHL OAuth flow mirrors it.
- `clients` table columns added in 2026-05-29:
  `ghl_access_token`, `ghl_refresh_token`, `ghl_token_expires_at`,
  `ghl_connect_status`, `ghl_connected_at`, `ghl_company_id`.

## Trigger to unpause

When Zoran reports: "GHL works end-to-end for BAM GTA — test SMS arrived,
Inbox shows conversations." That's the green light to build this wizard for
academy #2 onboarding.

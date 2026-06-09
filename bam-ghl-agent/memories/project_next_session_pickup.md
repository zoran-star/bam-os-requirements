---
name: Next-session pickup — READ FIRST
description: Current state + what to do next. Last updated 2026-06-08 after a big build session (parent payment funnel, CoachIQ model, offer⇄Stripe⇄CoachIQ price mapping + AI matcher, and The Pricing Sorter wizard — all merged to main/production).
metadata:
  type: project
---

# Next-session pickup (2026-06-08)

Everything below is **MERGED TO main / live on production** (portal.byanymeansbusiness.com),
mostly **V2/GTA-gated** so it only affects BAM GTA. Read the linked notes for detail.

## What got built this session

1. **Parent payment funnel** ([[project_parent_payment_funnel]]) — Vercel-hosted
   (`bam-portal/public/funnel/`), input → choose offer → sign+pay. Creates a
   PORTAL-OWNED Stripe sub via `api/onboarding/checkout.js`. **SANDBOX-TESTED end to
   end** (real test card → "You're in" success, $854.28 = $756+HST). Demo by default;
   `?live=1` = real mode. `api/onboarding/activations.js` fires GHL + CoachIQ on first
   paid invoice (wired into `api/stripe/webhook.js`, gated).

2. **CoachIQ model SETTLED** ([[project_coachiq_integration]]) — CoachIQ is an OPTIONAL
   per-academy add-on. Signup = portal auto-creates user (Zapier) + allocates product
   ("Add a Product Purchase" automation, one per product, store automation IDs).
   Renewals = systems-team TICKET for now. GHL = portal fires the EXISTING inbound
   webhook `{details:{user:{email},product:{id}}}` (Zoran's workflow does contact +
   plan + tag + WON + emails); portal is the ONLY trigger (turn CoachIQ's own
   send-to-GHL step OFF). GHL webhook URL is in Vercel env (`GHL_ONBOARDING_WEBHOOK_URL`).

3. **Offer ⇄ Stripe ⇄ CoachIQ price mapping + AI matcher** ([[project_offer_price_mapping]])
   — `/api/offers/match-prices` reads ALL live subs, groups by price, matches each to
   the academy's OWN offer prices (offers.data.pricing.pricing_offerings, base OR all-in),
   harvests CoachIQ product id from sub metadata. Tiers = **Live + Legacy only** (one
   Live per plan slot, enforced AI/UI/DB). Has RECENCY signal + ONE-TIME/prepaid scan.
   UI = "🤖 Match with AI" button in the Pricing Catalog view (client portal, V2/GTA-gated),
   offer-centric modal with dropdowns. `pricing_catalog` extended (offer_id,
   offer_price_key, coachiq_product_id, match_*).

4. **The Pricing Sorter wizard** ([[project_pricing_sorter_wizard]]) — built via a
   multi-agent workflow, MERGED. 3-step onboarding wizard (client portal, V2/GTA-gated,
   launch button next to Match-with-AI for now): Step1 boxes+arrows price match +
   `api/offers/create-price.js` (writes a Stripe price on approval); Step2 CSV →
   `api/sorter/map-columns.js` (AI mapping) → `api/sorter/import.js` → `members_staging`
   table (APPLIED); Step3 `api/sorter/cleanup.js` (check + promote into live members).

Portal fixes: point-of-contact name+email now per-academy on switch; top-right
onboarding widget retired (it's in Action Items); pricing names fixed ("Steady — 3 Months").

## ⚠️ Risks to remember
- The Pricing Sorter **Step 1 writes to LIVE Stripe** on approval (no dry-run); **promote
  copies into the live `members` table** — test carefully on GTA first.
- Funnel `/funnel/` is demo unless `?live=1`.

## Open / next
- **TEST The Pricing Sorter on GTA** (test CSV at `~/Downloads/gta-members.csv`, 54
  members) — Zoran was about to. Tune boxes+arrows + AI column mapping from feedback.
- Pricing Sorter **staff-portal (React) port** — not built (backend is shared).
- Pricing Sorter proper launch = seed a `pricing_sorter` onboarding action_item
  (currently a temp button).
- CoachIQ go-live: build per-product automations + Zapier + rotate key + product map.
- Track B migration of ~50 legacy subs to portal-owned (do last).

## Gotchas / how to work here
- Repo root = `/Users/zoransavic` (home dir). The session branch `feat/playground`
  LACKS the bam-portal recent work → **always work in a git worktree off `origin/main`**
  (`git worktree add -b <branch> /tmp/wt origin/main`), edit, `node --check`, commit,
  push, `gh pr create` + `gh pr merge --merge` (main is PROTECTED). Use `-b` when adding
  the worktree or push fails (detached-HEAD glitch hit twice).
- `vercel env pull` values carry a literal trailing `\n` — strip with `tr -d '\r\n"'`
  THEN `${V%\\n}` or the key is rejected. `vercel env add NAME preview <branch> --value X --yes`.
- API endpoints: ESM, raw fetch. Stripe = `STRIPE_CONNECT_SECRET_KEY` + `Stripe-Account`
  header on `clients.stripe_connect_account_id`. Anthropic = raw fetch x-api-key,
  `claude-sonnet-4-6` (matcher). Auth = resolveUser() Supabase-JWT (staff or client_users).
  client-portal.html is one huge static file — additive vanilla JS, V2-gate via
  `data-feature="members"` / `V2_ACCESS`. Validate by extracting new fns + `node --check`.
- BAM GTA client_id = `39875f07-0a4b-4429-a201-2249bc1f24df`. Plans: Steady 1×/$200,
  Accelerated 2×/$280, Elevate 3×/$335, Dominate unltd/$565 (+HST; +3mo/6mo). Connected
  acct `acct_1P7kUCRxInSEtAh8`.

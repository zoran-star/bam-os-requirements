---
name: Offer ⇄ Stripe ⇄ CoachIQ price mapping (BB Pricing) + AI matcher
description: Per-academy feature — in the client portal Business Blueprint → Offers → Pricing section, tie each offer-price (plan × term) to a Stripe price (canonical + legacy) and a CoachIQ product. A re-runnable "Match with AI" button reconciles live Stripe subs to offer-prices (review-first). Becomes THE source the signup funnel reads. Decided 2026-06-07.
metadata:
  type: project
---

# Offer ⇄ Stripe ⇄ CoachIQ price mapping

The pricing brain that ties the clean Business-Blueprint offers to the messy real
Stripe prices + CoachIQ products, and feeds the signup funnel. See
[[project_parent_payment_funnel]] (the funnel that consumes it) and
[[project_offer_architecture]] (the Offer model it lives inside).

## Decisions (Zoran, 2026-06-07)

- **Offer shape:** ONE "Training" offer; its Pricing section lists the plans × terms
  (Steady/Accelerate/Elevate/Dominate × Monthly/3mo/6mo). Each price ROW gets the ties.
- **Each price row ties to:** a Stripe **canonical** price + N **legacy** Stripe prices,
  and **one CoachIQ product**.
- **Legacy prices = recognize old subs ONLY** (grandfathered subs map to this offer-price
  for management/reporting/buttons). NEW signups ALWAYS use the canonical price.
- **"Match with AI"** button — **re-runnable anytime**, **review-first** (AI proposes with
  reasoning + confidence, flags uncertain ones, ASKS the owner; owner approves → saved).
- **Match signals:** price amount (strongest) · product/price name · billing interval ·
  sub metadata (productId/userId/plan) · `application` (CoachIQ/GHL/manual origin) · and
  ask-the-owner for ambiguous ones.
- **CoachIQ products:** pulled NOT from the CoachIQ API (auth-walled — can't list products)
  but **harvested from Stripe sub metadata.productId** (CoachIQ stamps it on every sub it
  made). Products with no live sub yet = manual entry. (Dropdown populated from harvested +
  manual.)
- **Source of truth:** this mapping REPLACES the current pricing_catalog lookup the funnel
  uses — the funnel reads the offer-price's canonical Stripe price + CoachIQ product to
  charge + allocate.
- **Multi-tenant:** built generic — every academy maps its own offers ↔ Stripe ↔ CoachIQ.

## Storage — extend pricing_catalog (already fits)

`pricing_catalog` is already per-academy, already has the tiers (canonical / legacy_unknown
/ legacy_match / deprecated / lil_sale), stripe_price_id, stripe_product_id, amount_cents,
interval, hst_mode, is_routable, notes, and an EMPTY `metadata` jsonb. We add the offer
linkage + CoachIQ id + match bookkeeping:
- `offer_id uuid` → offers(id)
- `offer_price_key text` → which price-row within the offer, e.g. "2/wk|3_months"
- `coachiq_product_id text` (or metadata.coachiq_product_id)
- `match_status text` (unmatched | proposed | confirmed)
- `match_confidence numeric`, `match_source text`, `matched_at timestamptz`
The `tier='canonical' AND is_routable` row per offer_price_key = the one new signups use.

## BAM GTA reality (the example — see docs/api-data-map.html)

54 members · 50 with a Stripe sub · 27 distinct Stripe products · 31 catalog rows ·
12 canonical (the rest legacy) · 21/54 have a coachiq_member_id · 54/54 have a ghl_contact_id.
Messy real prices the matcher must group: e.g. 2×/wk canonical $316 (plan_ThYK86w2Zd8fp3)
vs legacy $770 (Tushar/Arnav 3mo) vs $280 (Syed Faiz); 1×/wk "Joey GHL Dynamic" $213;
unlmtd "lil sale" $395.50; deprecated "Advanced" $356. Stripe `application` id reveals
origin: CoachIQ (ca_G3zg…) / GHL (ca_D5Mp…) / null=manual.

## Build phases

1. **Data model** — additive columns on pricing_catalog (above). Safe/nullable.
2. **AI matcher endpoint** — reads the academy's live subs (all origins) + their price/
   product/amount/interval/metadata, groups them, proposes offer_price_key + tier +
   coachiq_product_id per group with confidence + reasoning; returns PROPOSALS (review-first).
3. **BB Pricing UI** — in the offer's Pricing section: per price-row, show canonical + legacy
   Stripe prices + the CoachIQ product; "Match with AI" button → review/approve screen.
4. **Funnel rewire** — checkout reads the canonical Stripe price + CoachIQ product from the
   offer-price mapping instead of the current pricing_catalog canonical lookup.

## API collectability (what the matcher can pull) — full map in docs/api-data-map.html

- STRIPE (connected acct): sub (status, items[].price, application, metadata), price
  (unit_amount, recurring, product), product (name), customer (email/name/phone), invoice.
  ✅ richest source.
- COACHIQ: ❌ list-products via API (auth-walled); ✅ fire automations via webhook; product
  ids ⚠️ harvested from Stripe metadata.productId.
- GHL: ✅ contact (tags, customFields), opportunity (stage, status won/lost), conversations.
- SUPABASE: members (the Stripe↔GHL↔CoachIQ join per athlete) + pricing_catalog (last
  match, frozen).

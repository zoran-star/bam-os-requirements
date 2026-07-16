# What counts as a LIVE price (the one true rule)

**Status 2026-07-16:** rule settled after repeated confusion where agents asked for "GTA's live prices" and returned legacy/duplicate rows. Read this BEFORE answering any "what are academy X's live prices" question.

## The rule

> A price is **LIVE** for an academy iff ALL of:
> 1. `pricing_catalog.tier = 'canonical'`
> 2. `match_status = 'confirmed'`
> 3. `is_routable = true`
> 4. its `offer_price_key` resolves to a **non-archived** offering in the academy's active Offer (`offers.data.pricing.pricing_offerings[].archived` = false)
>
> Everything else - `legacy_match`, `legacy_unknown`, `deprecated`, `lil_sale`, unmatched/proposed, non-routable, or tied to an archived offering - is NOT live. Legacy rows exist only so existing subscriptions stay recognized.

The strictest existing implementation of this is `_offerPriceStatus()` in `client-portal.html` (~line 43224), which powers the contact-card `(live)`/`(legacy)` badge and the roster "Live price"/"Archived" pills. Match that logic; don't invent a looser one.

## Why the confusion happens

- `tier='canonical'` ALONE is not "live": GTA has 23 canonical rows including unmatched commitment prices and **duplicate canonicals** for the same plan x term (two Steady 6-month canonicals at $1000 and $1130; a confirmed-but-non-routable "Elevate Dynamic" next to an unmatched routable "Elevate").
- `api/pricing.js` returns ALL catalog rows with no liveness filter - do not present its output as "the live prices".
- **Stripe's `price.active` is mirrored NOWHERE** in `pricing_catalog`. A price archived in the Stripe dashboard still looks canonical in the catalog. (Known gap - fix = add `stripe_active` column + sync, not yet built.)

## GTA's actual live prices (verified against prod DB 2026-07-16)

Where members actually sit: Summer Unlimited Monthly $315.27/4wk (29 members), Summer Unlimited 3mo $850.89 (5), Steady $226/4wk (7), plus 2 stragglers on legacy rows.

## Known follow-ups (not built)

1. Add `stripe_active boolean` to `pricing_catalog`, stamped from Stripe `price.active` by match-prices/sync; fold into the rule.
2. De-duplicate competing canonical rows per `offer_price_key` in the GTA data (the create-price demote logic enforces one-canonical-per-plan-term on write, but historical seed rows violate it).

Related: [[project_offer_price_mapping]], [[project_member_mgmt_kpis]], [[project_change_plan_flow]]

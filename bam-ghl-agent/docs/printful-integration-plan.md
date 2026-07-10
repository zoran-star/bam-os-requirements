# Printful Integration - Plan (workshop in progress)

**Status:** Scoped, NOT built. Workshop 90% done - 3 small questions (A/B/C) still open.
**Owner:** Zoran. **Last touched:** 2026-07-10.

Goal: let academies sell merch (print-on-demand via Printful). Two order paths -
parents buy on a website, staff place bulk orders in the client portal.

---

## Core money flow (the key mental model)

Printful ALWAYS charges the academy's assigned card. The academy is Printful's
customer. Parents never touch Printful.

```
WEBSITE:  Parent → pays RETAIL via Stripe → academy
                   academy's Printful card → charged base + shipping
                   academy keeps:  retail − base − shipping = PROFIT

BULK:     Staff → orders in portal → no parent
                  academy's Printful card → charged base + shipping
                  academy eats the cost (team kits, giveaways, staff gear)
```

Same card both paths. Difference = who pays the academy back (parent on website,
nobody on bulk).

---

## LOCKED decisions

| # | Decision | Choice |
|---|---|---|
| Account model | Who owns the Printful account | **HYBRID** (see below) |
| Website merch page location (Q1) | Where parents buy | **Portal-hosted page**, academy links to it from their GHL site |
| Retail pricing (Q2) | Where retail price is set | **In the client portal** (not in Printful). Pull base cost from Printful, academy sets retail in portal |
| Parent accounts (Q3) | Login required? | **Pure guest checkout**, no accounts |
| Bulk ship-to (Q4) | Fixed or per-order | **Staff picks ship-to per order** |
| Website payment | Who pays what | **Parent pays retail** via Stripe |
| Bulk payment | Who pays | **Academy's Printful card** (no Stripe) |

### Account model = HYBRID (the big one)

```
Each academy has:  printful_connection_type
          ┌───────────────┴───────────────┐
     BAM_SHARED                       OWN_ACCOUNT
   (BAM-owned academies)            (3rd-party academies)
   1 shared BAM Printful acct       their own Printful acct
   → their store + their card       → they OAuth-connect it
   → uses BAM master API token      → their own token stored
          └───────────────┬───────────────┘
   Once we have (token + store_id), catalog/order/tracking code is IDENTICAL
```

Confirmed via Printful docs: one account can hold many stores, and you can assign a
**different billing card per store** (Billing → Billing methods → assign per store).
Unassigned/failed cards fall back to the account's primary card - so for BAM_SHARED,
ALWAYS assign every store its own card, never leave one on the BAM fallback.
Ref: https://help.printful.com/hc/en-us/articles/360014068279-How-do-I-assign-a-specific-billing-method-to-a-store

| | BAM academies | Other academies |
|---|---|---|
| Account | Shared BAM Printful account | Their own |
| Store | One store per academy under BAM | Their whole account |
| Card | Their card, assigned to their store | Their card, their account |
| Auth | BAM master API token | OAuth per academy |
| Setup | BAM adds store + card | Academy clicks "Connect Printful" |
| Flag | connection_type = bam_shared | connection_type = own_account |

---

## The 4 build pieces

```
① CONNECT        ② CATALOG         ③ ORDER            ④ TRACK
Connect store    Pull Printful     Two entry points   Webhook syncs
(shared or own)  products, set     → website (retail) fulfillment
                 retail in portal  → portal (bulk)     status → pills
```

### ① Connect
- bam_shared: BAM master token + store_id per academy
- own_account: academy OAuth → token stored per academy
- Prereq: academy has designed products in Printful + a card assigned

### ② Catalog
- Academy designs merch in Printful's own mockup tool (their store, not us)
- Pull "sync products" via API → cache in Supabase
- Academy sets RETAIL price per product in the portal (base cost shown, margin = retail − base − est shipping)
- Catalog shows in 2 places: website store grid + portal bulk picker

### ③ Order - two paths
**Website (guest retail):**
```
Guest browses portal-hosted merch page → picks item + variant
  → enters shipping address → Printful shipping-rate API quotes shipping
  → total = portal retail + shipping (+ tax?) → Stripe guest checkout (academy Stripe)
  → on success → POST order to Printful → academy card charged base
```
**Portal (staff bulk):**
```
Staff → Merch tile → pick products + qty → enter ship-to for THIS order
  → confirm → POST to Printful → academy card charged, no Stripe
```

### ④ Track
- Register Printful webhook per academy/store → new portal endpoint
- Events: order_created, package_shipped, order_failed
- Update printful_orders.status → status pills (Pending / Printing / Shipped / Failed)

---

## Data model (new tables/cols in Supabase)

| Table | Holds |
|---|---|
| academy_integrations (or cols on academy) | printful_connection_type, printful_token, printful_store_id, printful_card_assigned (bool) |
| printful_products | cached catalog per academy: id, name, variants, base_cost, retail_price (portal-set), mockup_img |
| printful_orders | order id, academy, path (website/bulk), status, base_cost, retail, recipient (per-order ship-to) |

---

## Build phases

```
Phase 1  →  Connect + Catalog (read-only)      [prove the API works, both conn types]
Phase 2  →  Portal bulk orders + tracking      [staff-only, no Stripe]
Phase 3  →  Website retail + Stripe guest checkout   [the hard one]
```

---

## STILL OPEN - answer these to finish the workshop

- **A - Stripe reuse:** website checkout reuses the academy's existing Stripe (the one used for memberships)? Assumed yes.
- **B - Shipping cost:** live-quoted from Printful at checkout (parent sees real cost) vs a flat fee? Leaning live-quoted.
- **C - Sales tax:** Printful auto-calc at checkout, or skip for v1?

## THEN write up
1. Notion requirements (new job IDs - likely a new commerce/MERCH group, or under Settings + a new domain)
2. Onboarding data points (printful_connection_type, store id, token, card-assigned confirmation, retail prices)
3. This phased build ticket into the portal backlog

## Where it lives when built
- Portal app: `bam-ghl-agent/bam-portal/` (React/Vite + `api/` serverless + Supabase)
- New "Merch" tile in the client portal for bulk orders
- New portal-hosted public merch page per academy (guest checkout)

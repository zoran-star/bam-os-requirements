# Printful Merch Integration — PLAN (not built)

**2026-07-10. Status: scoped, workshop ~90% done. Nothing built.**
Full plan doc: [`docs/printful-integration-plan.md`](../docs/printful-integration-plan.md) — read that to pick up.

**Goal:** academies sell print-on-demand merch via Printful. Two order paths:
parents buy on a website, staff place bulk orders in the client portal.

**Money model (key):** Printful always charges the academy's assigned card (academy is
Printful's customer, parents never touch Printful).
- Website: parent pays RETAIL via academy's Stripe → academy card charged base+ship → academy keeps margin.
- Bulk: staff order in portal, academy card charged, no Stripe, academy eats cost.

**LOCKED decisions:**
- **Account model = HYBRID.** BAM-owned academies → one shared BAM Printful account, a store + assigned card per academy (`connection_type = bam_shared`, BAM master API token). 3rd-party academies → connect their own account via OAuth (`connection_type = own_account`). Once you have (token + store_id) the catalog/order/tracking code is identical.
  - Printful supports per-store card assignment under one account (Billing → Billing methods). MUST assign every store its own card or it falls back to BAM's primary. Ref: help.printful.com/hc/en-us/articles/360014068279
- Website merch page = **portal-hosted**, academy links from their GHL site.
- Retail price **set in the portal** (base cost pulled from Printful, margin shown).
- **Guest checkout** (no parent accounts).
- Bulk **ship-to picked per order** by staff.

**4 build pieces:** ① Connect (shared/own) ② Catalog (pull sync products, set retail) ③ Order (website guest retail + portal bulk) ④ Track (Printful webhooks → status pills).

**Phases:** 1) Connect+Catalog read-only → 2) Portal bulk + tracking → 3) Website retail + Stripe guest checkout (hardest).

**New data:** `printful_connection_type`, `printful_token`, `printful_store_id`,
`printful_card_assigned` per academy; `printful_products` (base_cost, portal retail, mockup);
`printful_orders` (path, status, recipient).

**STILL OPEN (answer to finish workshop):**
- A: website checkout reuses academy's existing Stripe? (assumed yes)
- B: shipping = live-quoted from Printful vs flat fee? (leaning live)
- C: sales tax = Printful auto-calc vs skip v1?

**THEN:** write Notion requirements (new commerce/MERCH job IDs) + onboarding data points, and
drop the phased build ticket into the portal backlog. V2-only (gate off V1).

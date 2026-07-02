# Offer Tie-In Plan (BAM GTA v2)

Owner: Zoran. Last updated: 2026-07-02.
Status: approved by Zoran + Luka ("you're good to rip", 2026-07-02). Part 1 in progress.

## The idea, simply

Today all machinery (ads, funnel, pipeline, agents, member rules) is bolted to
the ACADEMY. This plan re-keys it to the OFFER, so launching ADAPT or a camp
means creating an offer, not rebuilding the machinery.

```text
BEFORE                          AFTER

     BAM GTA                      BAM GTA
        |                        ┌───┴──────┐
   [one pile of              TRAINING     ADAPT
    everything]              ├ its ads    ├ its ads
                             ├ its funnel ├ its funnel
                             ├ its board  ├ its board
                             ├ its agents ├ its agents
                             └ its rules  └ its rules
```

Two parts:

- **Part 1 - offer_id spine (this doc's Wave 1).** Label every lead-touching
  surface with the offer it belongs to. One pipeline per offer (decided).
- **Part 2 - money -> access (Phases 6.8, 5, credit engine, checkout).**
  Typed prices + confirmed entitlement rules; paid invoice auto-grants access.

## Decisions log

| Date | Decision |
|---|---|
| 2026-07-02 | Schema wiring first, then hub UI / per-offer behavior |
| 2026-07-02 | One pipeline per offer (not shared board with offer tags) |
| 2026-07-02 | Luka unblocked: entry_points.bookable_program_id (add drift check), Phase 6.8 sync, Phase 5 webhook (we build), credit engine, checkout/members/sorter cutover |
| 2026-07-02 | Entitlement source_ref convention: `subscription:<sub_id>:<price_id>` for subs, `invoice:<invoice_id>:<price_id>` for one-time purchases (Luka's Claude rec, adopted) |
| 2026-07-02 | Slot auto-extend cron stays with Luka; monthly Routine covers until then |

## Part 1 - offer_id spine (Wave 1)

All target tables are Zoran-owned; additive columns = "always fine" per
`parent-app-db-boundary.md`. GTA backfill target: Training offer
`52a6285c-7832-44e1-b531-ab7ef9d8fc21` (client `39875f07-0a4b-4429-a201-2249bc1f24df`).

| # | Change | Backfill (GTA) | Unlocks |
|---|---|---|---|
| 1 | `pipeline_stages.offer_id` + `opportunities.offer_id` | 5 stages + 29 opps -> Training | One pipeline board per offer; ADAPT = new stage rows, zero refactor |
| 2 | `automations.offer_id` | 8 rows -> Training | Per-offer Ghosted / Lead Nurture sequences |
| 3 | `agent_prompt_sections.offer_id` (+ `agent_lessons` scope audit) | NULL = academy-wide; GTA sections stay NULL until per-offer brains diverge | Per-offer agent brains |
| 4 | `website_leads.entry_point_id` + `website_leads.offer_id` | via entry_points routing where resolvable | Full lineage: ad -> form -> lead -> pipeline -> member |
| 5 | New table `offer_ad_campaigns` (offer_id <-> Meta campaign id) | seed from `clients.meta_campaign_ids` for GTA | Per-offer CAC; campaigns belong to an offer |
| 6 | `post_trial_reviews.offer_id` | 13 rows -> Training (via opportunity) | Staff sales forms keyed to offer |

Write-path stamping: every INSERT site for the tables above sets offer_id at
creation time (opportunities from the entry_points row / pipeline stage, leads
from the entry_points row, post-trial from the opportunity).

RLS for `offer_ad_campaigns`: staff predicates (`is_staff()` / `my_client_ids()`),
never plain `authenticated` (parents hold real JWTs - see boundary doc).

## Part 2 - money -> access (build order)

Strict chain B -> C -> E; D gates weekly-credit plans in E.

| Step | What | Notes |
|---|---|---|
| B | Phase 6.8 offers sync (`POST /api/runtime/offers/sync`) | Derives typed `offer_options`/`offer_prices`/`entitlement_templates` from Blueprint JSON + `pricing_catalog`. Idempotent, archive-never-delete, lineage columns. Entitlement rules are CONFIRMED input, never inferred. Follow `parent-runtime-cutover-guardrails.md` |
| C | Phase 5 webhook access sync | Paid invoice -> entitlement activation. 5xx on failure so Stripe retries. Re-fetch state before downgrades. Resolve via `offer_prices.stripe_price_id`. Uses the source_ref convention above |
| D | Credit engine activation | First: Stripe interval check (monthly ~4.35wk vs "1/Wk" promise -> real `invoice_grant_credits`). Then cron/webhook wiring per Phase 6 checklist |
| E | Checkout cutover | Offer page reads typed rows (read-only, can go early); checkout sells `offer_price_id`; weekly-credit plans hidden until D done; low-traffic window |
| F | members.js / sorter spine | Every member-minting path ends with the full identity spine (use `api/_runtime/` helpers, never hand-rolled) |
| G | `entry_points.bookable_program_id` + drift check in runtime diagnostics | Luka OK'd; add the diagnostics check so funnel and trial APIs never disagree |

## Guardrails that still apply

Everything in `parent-runtime-cutover-guardrails.md`, especially: typed rows =
operational truth; access only after money moves; idempotency in the DB;
capacity via `slot_spots_taken` only; scheduling writes via RPCs only; deny-all
RLS stays deny-all; new API code in TS; migration files committed with the exact
MCP-recorded version.

## Progress

- [x] Plan approved (Zoran + Luka)
- [x] Wave 1 migration (columns + backfill + offer_ad_campaigns) - PR #1052
- [x] Write-path stamping (opportunities, leads, post-trial, automations) - PR #1052
- [x] B: offers sync - PRs #1054/#1055, APPLIED to prod (31 typed prices live)
- [x] C: webhook access sync - built + shipped DORMANT (`clients.access_sync_mode`
      off/shadow/on; migration `20260702224203`). Activation = Phase 6 cutover:
      shadow-watch GTA, then flip to on.
- [x] D: credit engine ACTIVATED (2026-07-02). Interval check: all monthlies are
      true week x4 (no 48/52 gap); grants = sold promise (monthly N x4, 3mo N x12,
      6mo N x24) in template config invoice_grant_credits (migration
      `20260702231435`). Webhook grants on paid invoices behind
      `clients.credit_engine_enabled`; daily expiry sweep cron
      `/api/runtime/credits/cron-sweep`; opening balances backfilled via
      `scripts/credit-backfill-run.mjs`.
- [ ] E: checkout cutover
- [ ] F: members/sorter spine
- [ ] G: entry_points.bookable_program_id + drift check

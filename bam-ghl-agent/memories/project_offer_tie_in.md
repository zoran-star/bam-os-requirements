# Offer tie-in (BAM GTA v2) - offer_id spine + money->access roadmap

**Status 2026-07-02: Wave 1 SHIPPED + B (offers sync) LIVE IN PROD. Next: C (webhook access sync).**
Full plan: [`docs/offer-tie-in-plan.md`](../docs/offer-tie-in-plan.md). Approved by Zoran + Luka.

## The model

Everything lead-touching is keyed to the OFFER, not the academy. **One pipeline
per offer** (decided). ADAPT/camps launch by creating an offer + its rows, not
new code. GTA anchor ids: client `39875f07-0a4b-4429-a201-2249bc1f24df`,
Training offer `52a6285c-7832-44e1-b531-ab7ef9d8fc21`.

## Wave 1 (migration `20260702212043_offer_tie_in_wave1_offer_spine.sql`, applied to prod)

- `offer_id` added to: `pipeline_stages`, `opportunities`, `automations`,
  `agent_prompt_sections` (NULL = academy-wide brain), `website_leads`
  (+ `entry_point_id`), `post_trial_reviews`.
- New `offer_ad_campaigns` (client_id, offer_id, campaign_id) - Meta campaigns
  belong to an offer; select RLS is_staff/my_client_ids, writes service-role only.
- Backfill: all GTA stages/opps/automations/post-trial -> Training; leads ->
  their entry_point's offer (adapt-form leads correctly NULL until an ADAPT
  offer exists); GTA `clients.meta_campaign_ids` seeded into offer_ad_campaigns.

## Write-path stamping (same PR)

- `api/agent/_store.js` createOpp: opp inherits `offer_id` from its stage row
  (one pipeline per offer => board determines offer); explicit `opts.offerId`
  overrides. Best-effort, never blocks the create.
- `api/website/leads.js`: entry_points select now pulls `id,offer_id`; lead is
  PATCHed with `entry_point_id` + `offer_id` right after routing lookup
  (save-first design kept: lead row exists before the stamp).
- `api/ghl/post-trial.js`: review row stamped with the opportunity's offer_id
  (portal-provider path; GHL path stays NULL).
- `api/automations.js`: upsert-automation accepts optional `offer_id`
  (key only included when provided - old callers can't clobber to null);
  seed-form-intro stamps it on create.

## Semantics gotcha

A LEAD's offer comes from its ENTRY POINT; an OPPORTUNITY's offer comes from its
STAGE/board. They can differ (an adapt lead pushed onto the Training board keeps
lead.offer=NULL/adapt while opp.offer=Training). That's deliberate.

## B: offers sync - BUILT (endpoint `api/runtime/offers-sync.ts`)

`POST /api/runtime/offers/sync` (staff Bearer). Body: `{client_id, offer_id,
mode: preview|apply, bookable_program_id, entitlement_rules: {<planKey>:
{kind:WEEKLY_CREDITS,credits_per_period}|{kind:UNLIMITED_BOOKING}}}`.
- Derives options/prices/templates from CONFIRMED `pricing_catalog` rows
  (`offer_price_key` = "Plan|term"); Blueprint JSON only supplies plan order +
  archived flags. ALL confirmed rows get typed (incl. legacy - that's how the
  Phase 5 webhook will resolve old subs).
- `is_active` = catalog.is_routable; typed `is_routable` = catalog routable AND
  plan not archived in Blueprint AND rule confirmed (no rule = never sellable).
- Converges on the uniqueness guards (source_pricing_catalog_id, stripe_price,
  one-ACTIVE-template-per-price); staff-curated titles never overwritten;
  vanished sources deactivated, never deleted. Rerun-safe (23505 refetch).
- Unlimited templates: credit_cost_policy FREE; weekly: PER_SLOT_CREDIT_COST
  (mirrors Luka's backfill).
- Tests: `api/runtime/offers-sync.test.ts` (9 pure planning tests, run under
  `npm run test:runtime`). Smoke vs prod snapshot: Luka's 6 rows all
  "unchanged"; would create 3 options + 25 prices + 25 templates; routable set
  unchanged (Steady + Summer Unlimited).
- GTA rules (confirmed, handoff doc): Steady 1/wk, Accelerate 2/wk, Elevate
  3/wk, Dominate unlimited, Summer Unlimited unlimited. GTA program id
  `80000000-0000-4000-8000-000000000001`.
- ✅ APPLIED TO PROD 2026-07-02 via `scripts/offers-sync-run.mjs` (service role,
  Vercel env): created 3 options + 25 prices + 25 templates. Prod now: 5
  options, 31 prices (all 31 confirmed catalog rows typed, 0 missing lineage),
  31 ACTIVE templates, routable set unchanged (5). Idempotency verified: rerun
  preview = 31/31 unchanged.
- ⚠️ Gotcha: Vercel prod env values (VITE_SUPABASE_URL etc) contain a literal
  trailing "\n" two-char sequence; `requireEnv` does not trim. Strip when using
  pulled env locally (`sed 's/\\n//g'`).
- Endpoint refactor: handler = auth shell around exported `runOffersSync`
  (PR #1055); operator script `scripts/offers-sync-run.mjs` (preview default,
  `--apply` to write, GTA rules preset).

## Next (Part 2, money->access; order C->D->E->F->G)

C Phase 5 webhook access sync (paid invoice -> entitlement; 5xx on failure;
  source_ref convention DECIDED: `subscription:<sub_id>:<price_id>`, one-time
  `invoice:<invoice_id>:<price_id>`) ->
D Stripe interval check then credit engine activation ->
E checkout sells typed offer_price_id (weekly-credit plans hidden until D) ->
F members.js/sorter full identity spine ->
G `entry_points.bookable_program_id` + drift check (Luka OK'd all of this 2026-07-02).

Guardrails: `docs/parent-runtime-cutover-guardrails.md` still applies in full.

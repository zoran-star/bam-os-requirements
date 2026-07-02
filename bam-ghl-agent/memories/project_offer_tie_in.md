# Offer tie-in (BAM GTA v2) - offer_id spine + money->access roadmap

**Status 2026-07-02: Wave 1 SHIPPED (schema + stamping). Parts B-G not started.**
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

## Next (Part 2, money->access; order B->C->D->E->F->G)

B `POST /api/runtime/offers/sync` (typed rows from Blueprint JSON + pricing_catalog;
  entitlement rules are CONFIRMED input, never inferred) ->
C Phase 5 webhook access sync (paid invoice -> entitlement; 5xx on failure;
  source_ref convention DECIDED: `subscription:<sub_id>:<price_id>`, one-time
  `invoice:<invoice_id>:<price_id>`) ->
D Stripe interval check then credit engine activation ->
E checkout sells typed offer_price_id (weekly-credit plans hidden until D) ->
F members.js/sorter full identity spine ->
G `entry_points.bookable_program_id` + drift check (Luka OK'd all of this 2026-07-02).

Guardrails: `docs/parent-runtime-cutover-guardrails.md` still applies in full.

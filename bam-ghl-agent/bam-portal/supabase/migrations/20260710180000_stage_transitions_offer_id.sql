-- Pipeline Presets — Phase 2: add offer_id to stage_transitions.
--
-- Decision (Zoran, 2026-07-10): a pipeline preset hangs on the OFFER, not the
-- academy. `pipeline_stages.offer_id` and `opportunities.offer_id` already exist
-- (offer-spine wave 1, migration 20260702212043); stage_transitions was the one
-- pipeline table still missing it. apply_preset() stamps the offer onto every
-- stage + edge it writes, so a preset's flow is tagged to its offer.
--
-- PURELY ADDITIVE + DORMANT. Nullable, no backfill, no unique-key change. The
-- router (api/agent/_router.js resolveEdge) still reads edges by
-- (client_id, from_stage_role, trigger, pipeline_id IS NULL) and ignores offer_id,
-- so the two live portal academies (BAM GTA, DETAIL Miami) route byte-identically.
-- offer_id becomes load-bearing when the readers go offer-aware (Phase 3) — which
-- is the same step that lets ONE academy run TWO offer pipelines at once. Until
-- then apply_preset targets NEW academies (one offer, one pipeline, no collision).
-- FK matches the existing offer_id columns: plain REFERENCES offers(id).

alter table public.stage_transitions
  add column if not exists offer_id uuid references public.offers(id);

create index if not exists stage_transitions_offer_idx
  on public.stage_transitions(client_id, offer_id);

comment on column public.stage_transitions.offer_id is
  'The offer whose pipeline preset this edge belongs to (Phase 2). Written by apply_preset(). Nullable = legacy academy-wide edges seeded before per-offer presets. Not yet used by the router (resolveEdge stays offer-agnostic until Phase 3).';

-- Re-key the edge unique to include offer_id, and fix a latent idempotency bug:
-- EVERY edge has a NULL in the key (a stage edge has to_terminal NULL; a terminal
-- edge has to_stage_role NULL), and the old constraint was NULLS-distinct, so
-- ON CONFLICT never actually matched — re-running the seed / a re-stamp would
-- DUPLICATE every edge. NULLS NOT DISTINCT makes re-stamps idempotent AND scopes
-- uniqueness per offer. Same CONSTRAINT NAME so seed_default_stage_transitions'
-- `on conflict on constraint stage_transitions_edge_uniq` keeps working.
-- Verified before shipping: zero exact-duplicate edges exist, so this builds clean.
alter table public.stage_transitions drop constraint if exists stage_transitions_edge_uniq;
do $$ begin
  alter table public.stage_transitions
    add constraint stage_transitions_edge_uniq unique nulls not distinct
      (client_id, offer_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal);
exception when duplicate_object then null; end $$;

-- Off-GHL pipeline store, P1 dual-write (Effort E, PR 2). PURELY ADDITIVE, DORMANT.
-- Adds the "shadow" toggle that turns on dual-write into the portal opportunities
-- store + self-seeding of the pipeline_stages registry, while reads still come
-- from GHL. This is the safe "populate + soak" mode that precedes flipping
-- clients.pipeline_provider to 'portal'.
--
-- Flip sequence the design intends (see docs/off-ghl-pipeline-store-design.md):
--   pipeline_shadow ON  -> the store self-populates as the board is used + leads
--                          move (reads still GHL, zero behavior change)
--   reconcile clean     -> set pipeline_provider='portal' (reads flip to the store)
--   later               -> stop GHL writes (P4)
--
-- Default is false for EVERY academy, so with this migration applied production
-- behaves byte-identically: nothing dual-writes and nothing reads the store until
-- an academy is explicitly opted in. V1/V1.5 stay false. BAM GTA (client_id
-- 39875f07-0a4b-4429-a201-2249bc1f24df, V2) is the first opt-in target.

alter table public.clients
  add column if not exists pipeline_shadow boolean not null default false;

comment on column public.clients.pipeline_shadow is
  'When true, dual-write this academy''s opportunities into the portal opportunities table AND self-seed pipeline_stages from observed GHL stages. Reads still come from GHL (the safe populate+soak mode). Flip pipeline_provider to ''portal'' only after this has backfilled and reconciled. Default false; V1/V1.5 stay false.';

-- Per-client marketing goals for the Ad Performance dashboard.
--
-- The dashboard (api/marketing.js → handleMetaReport) colours each campaign's
-- CPL and spend against a target. If a client has a custom goal set here, that
-- value is used; otherwise the dashboard falls back to the industry-benchmark
-- defaults baked into MKT_BENCHMARKS (CPL ~$25).
--
-- Both columns are nullable on purpose — "no goal set" is a valid state that
-- means "use the industry default". Set them per client during onboarding or
-- from the staff portal.
--
-- Run once in the Supabase SQL editor (project ref jnojmfmpnsfmtqmwhopz).
-- The report endpoint is resilient to these columns NOT existing yet, so this
-- can be applied any time.

alter table public.clients
  add column if not exists meta_cpl_goal       numeric,  -- target cost-per-lead ($)
  add column if not exists meta_monthly_budget numeric;  -- planned monthly ad spend ($)

comment on column public.clients.meta_cpl_goal is
  'Target cost-per-lead ($) for the Ad Performance dashboard. NULL = use industry benchmark (~$25).';
comment on column public.clients.meta_monthly_budget is
  'Planned monthly ad spend ($). Used to show spend-vs-budget on the Ad Performance dashboard. NULL = no budget bar.';

alter table public.clients
  add column if not exists meta_cpl_goal       numeric,
  add column if not exists meta_monthly_budget numeric;

comment on column public.clients.meta_cpl_goal is
  'Target cost-per-lead ($) for the Ad Performance dashboard. NULL = use industry benchmark (~$25).';
comment on column public.clients.meta_monthly_budget is
  'Planned monthly ad spend ($). Used to show spend-vs-budget on the Ad Performance dashboard. NULL = no budget bar.';;

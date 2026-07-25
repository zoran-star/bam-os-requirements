-- Build T of the money model (docs/money-model-plan.md): the academy-level
-- sales tax TEMPLATE. Set once ({"label":"HST","pct":13}), then every price and
-- fee just flips taxable yes/no instead of retyping "13% HST" as free text on
-- every offering and commitment. NULL = the academy charges no tax (most US
-- academies). Setting the template IS the explicit opt-in (logic scan #1).
--
-- NOTE: this migration also redefined update_client_basics, but from a STALE
-- copy that dropped time_zone/kpi_data/onboarding_setup/ads_content_approval_
-- required. The very next migration (restore_update_client_basics_full_
-- whitelist) restores the full whitelist + tax_config; the function body here
-- is intentionally omitted so replay lands on the corrected definition only.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_config jsonb;

COMMENT ON COLUMN public.clients.tax_config IS
  'Academy sales-tax template {label, pct}. NULL = no tax. Prices/fees opt out per row via taxable:"No"; unset rows default taxable when a template exists. Money math: bam-portal/api/_fees.js resolveFee().';

-- Credit engine activation (offer tie-in step D).
-- 1) Per-academy gate for granting credits from paid invoices in the webhook.
-- 2) Real invoice_grant_credits per weekly-credit template, from the verified
--    Stripe intervals (2026-07-02 check): every *|monthly price is a literal
--    week x4 interval (13 invoices/yr x N = the weekly promise, no 48/52 gap);
--    3/6-month terms grant the SOLD promise block (12/24 weeks x N per week).
alter table public.clients
  add column if not exists credit_engine_enabled boolean not null default false;

update public.entitlement_templates et
set config = coalesce(et.config, '{}'::jsonb) || jsonb_build_object(
      'invoice_grant_credits',
      et.credits_per_period * case
        when op.source_offer_price_key like '%|monthly'  then 4
        when op.source_offer_price_key like '%|3_months' then 12
        when op.source_offer_price_key like '%|6_months' then 24
      end),
    updated_at = now()
from public.offer_prices op
where op.id = et.offer_price_id
  and op.tenant_id = et.tenant_id
  and et.entitlement_kind = 'WEEKLY_CREDITS'
  and et.status = 'ACTIVE'
  and et.credits_per_period is not null
  and op.source_offer_price_key ~ '\|(monthly|3_months|6_months)$';

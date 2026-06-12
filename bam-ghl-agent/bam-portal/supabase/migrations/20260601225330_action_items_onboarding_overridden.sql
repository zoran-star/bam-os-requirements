-- When a human checks/unchecks an onboarding step, mark it overridden so the
-- auto-reconcile (Stripe/GHL connect signals) stops forcing it — human wins.
alter table public.action_items
  add column if not exists onboarding_overridden boolean not null default false;;

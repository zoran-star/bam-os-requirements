-- Pipeline exit on payment: link a member to the EXACT GHL opportunity (the sales-
-- board card) so the Stripe webhook can mark it WON when the parent pays — making
-- member -> won fully portal-owned, independent of any GHL onboarding workflow
-- (the old path that gets skipped the moment an academy turns the portal
-- "onboarding" automation on). Threaded in from the website enroll funnel's opp_id
-- param (api/website/checkout.js -> Stripe sub metadata -> api/stripe/webhook.js).
-- Nullable: members created before this, or with no opportunity, simply have no link.
alter table public.members add column if not exists ghl_opportunity_id text;
create index if not exists members_ghl_opportunity_idx on public.members(client_id, ghl_opportunity_id);

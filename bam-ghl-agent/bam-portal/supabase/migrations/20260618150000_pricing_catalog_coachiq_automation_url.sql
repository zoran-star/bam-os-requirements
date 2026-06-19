-- Per-Stripe-price CoachIQ automation webhook link.
-- Each live price can carry the "Add a Product Purchase" automation URL pasted from
-- CoachIQ; the onboarding flow fires it (with the user id + Stripe sub_id) so the
-- right product/credits are granted per what the member bought, and CoachIQ can track
-- the subscription for renewal refreshes.
alter table pricing_catalog add column if not exists coachiq_automation_url text;

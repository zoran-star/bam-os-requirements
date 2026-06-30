-- Persisted "can the portal manage this member's billing" flag.
--
-- True  = the Stripe subscription was created BY the portal (sub.metadata.origin
--         in fullcontrol-portal / fullcontrol-website-enrollment) -> Change plan /
--         Pause / Refund work.
-- False = imported / foreign sub (GHL, dashboard, CoachIQ) -> those actions are
--         locked; staff must "Set up billing" to take it over.
-- Null  = not yet checked (lazily backfilled the first time the member drawer
--         opens, same pattern as members.stripe_joined_at).
--
-- Surfaced as a roster badge so staff see which members need "Set up billing"
-- without clicking into each one.
alter table public.members
  add column if not exists billing_portal_owned boolean;

comment on column public.members.billing_portal_owned is
  'True=portal-created Stripe sub (manageable); false=imported/foreign sub (needs Set up billing); null=not yet checked. Backfilled lazily on member-drawer open from sub.metadata.origin.';

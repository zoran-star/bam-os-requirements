-- Two OPTIONAL per-academy facts behind the onboarding welcome email.
--
-- The welcome email's quick-start list has two items that only make sense for an
-- academy that actually has the thing they point at: an online-programs library, and
-- a refer-a-friend perk. They used to be hardcoded to BAM GTA's URLs, which meant
-- every other academy's members were told to visit byanymeanstoronto.ca. Deleting
-- them fixed that for the master but silently changed a LIVE academy's mail, so they
-- are now gated on a fact instead: no fact, no line. The list renumbers around
-- whatever survives, so an academy with neither sends a shorter email, never a
-- broken one and never a gap. See api/email-templates/onboarding-emails.js.
--
-- NULL / empty (the default, and what every academy has) is the master behaviour:
-- neither block renders. This is the same "identity fails to EMPTY, never to another
-- academy's value" rule the email shell already applies to domain, support email and
-- Instagram.
--
-- NOT in brand_data on purpose. brand_data is the look-and-feel blob (colours, fonts,
-- logos, story copy) and is being restructured separately; these are operational
-- facts about what the academy offers, read at send time by the automations worker,
-- and they want to be independently queryable and independently NULL. Not on the
-- offer either: the welcome email is sent by the academy's onboarding automation and
-- the send path (api/email-shells.js renderEmail) is given a client id and no offer
-- context at all, so an offer-scoped home would need the offer plumbed through the
-- whole worker for a fact that does not actually vary by offer.
--
-- BAM GTA is NOT backfilled here. Its two values stay in the LOCATIONS entry in
-- api/email-shells.js (where GTA's other identity strings already live) so its live
-- mail is correct whether or not this migration has been applied, and so applying
-- this does not depend on touching a production row. Client-specific data belongs in
-- seeds, not migrations (supabase/README.md).
--
-- WHEN THIS IS APPLIED, one more edit is needed before the columns can reach a send:
-- loadClient() in api/automations.js selects an explicit column list, so add
-- online_programs_url,referral_offer to it. That list is deliberately NOT touched now
-- - selecting a column that does not exist yet 400s the whole request and would take
-- every automation email down with it. Until then the columns are inert and GTA
-- renders from its LOCATIONS entry.

alter table public.clients
  add column if not exists online_programs_url text;

alter table public.clients
  add column if not exists referral_offer jsonb;

comment on column public.clients.online_programs_url is
  'Full URL of the academy''s online-programs library, e.g. https://example.com/online-programs. Renders the "Access the online programs" item in the onboarding welcome email. NULL = the academy has no online programs and the item does not render.';

comment on column public.clients.referral_offer is
  'Refer-a-friend perk shown in the onboarding welcome email: { lead, body, merch_url? } - lead is the bold lead-in ("Bring a friend"), body the perk itself ("to training and you both get a free month plus some merch"), merch_url an optional shop the perk mentions. Missing lead or body is treated as no offer (half a sentence is worse than no line). NULL = no referral offer and the item does not render.';

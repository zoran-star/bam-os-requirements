-- offer_prices.billing_cadence - how a price actually RE-BILLS.
--
-- WHY A NEW COLUMN INSTEAD OF NEW TERM KEYS.
-- billing_interval already holds the term key (4_weeks / 3_months / 6_months /
-- one_time). That key is the COMMITMENT'S IDENTITY: it is what
-- source_offer_price_key joins on, what the signed agreement PDF's term noun
-- reads, and what checkout's commitment-revert logic gates on. LIVE rows -
-- BAM GTA among them - use 3_months and 6_months meaning calendar months, so
-- changing what those keys mean would change live billing for academies nobody
-- asked about. The keys therefore do not move.
--
-- What was missing is the CADENCE: San Jose's 3 and 6 month prepaid terms must
-- re-bill every 12 and 24 WEEKS, and true calendar-monthly did not exist at all.
-- The commitment free text cannot carry this - prod holds "12 Weeks (3 Months)"
-- (GTA) and "3 Months (12 Weeks)" (San Jose) for the same shape, and both match
-- the month pattern AND the week pattern. So the cadence is stored, explicitly,
-- per price row.
--
-- NULL IS THE POINT. NULL means "bill it the way this build always has", which
-- is intervalFor(term) in api/website/checkout.js. Every existing row stays NULL,
-- so this migration changes the billing of exactly nothing on the day it runs.
-- The code also ships AHEAD of this file and degrades without it: every read of
-- billing_cadence retries the select without the column, so an unapplied
-- migration is a no-op rather than an outage.
--
-- Vocabulary, mirrored by CADENCES in api/website/checkout.js and
-- api/offers/create-price.js (api/_billing-cadence.test.mjs fails on drift):
--   4_weeks            -> week  x 4    (today's default)
--   monthly            -> month x 1    (true calendar monthly, new)
--   12_weeks           -> week  x 12   (San Jose's 3 month term)
--   24_weeks           -> week  x 24   (San Jose's 6 month term)
--   3_calendar_months  -> month x 3    (today's 3_months, said out loud)
--   6_calendar_months  -> month x 6    (today's 6_months, said out loud)

alter table offer_prices
  add column if not exists billing_cadence text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'offer_prices_billing_cadence_check'
  ) then
    alter table offer_prices
      add constraint offer_prices_billing_cadence_check
      check (billing_cadence is null or billing_cadence in (
        '4_weeks', 'monthly', '12_weeks', '24_weeks',
        '3_calendar_months', '6_calendar_months'
      ));
  end if;
end $$;

comment on column offer_prices.billing_cadence is
  'How this price re-bills. NULL = the legacy shape for its billing_interval term (4_weeks -> week x4, 3_months -> month x3, 6_months -> month x6). Set it only to say something the term key cannot: 12_weeks / 24_weeks for week-counted commitments, monthly for true calendar monthly. Vocabulary lives in CADENCES in api/website/checkout.js.';

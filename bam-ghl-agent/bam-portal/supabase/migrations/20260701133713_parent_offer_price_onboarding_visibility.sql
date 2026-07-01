-- Parent offer runtime visibility:
-- Some active/routable prices should be available for direct checkout without
-- appearing in public onboarding price lists.

ALTER TABLE public.offer_prices
    ADD COLUMN IF NOT EXISTS show_on_onboarding boolean NOT NULL DEFAULT true;

-- Tie members to offers (V2 offer-centric model — mirrors entry_points.offer_id).
-- A member's offer is derived from their Stripe price via pricing_catalog during
-- the Pricing Sorter import/promote. Nullable: a member whose price isn't mapped
-- to an offer yet stays NULL and surfaces in the cleanup "no offer" flag.
ALTER TABLE members         ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id);
ALTER TABLE members_staging ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id);

CREATE INDEX IF NOT EXISTS members_offer_id_idx         ON members         (client_id, offer_id);
CREATE INDEX IF NOT EXISTS members_staging_offer_id_idx ON members_staging (client_id, offer_id);

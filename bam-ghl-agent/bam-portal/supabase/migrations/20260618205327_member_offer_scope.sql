-- Tie members to offers (V2 offer-centric model — mirrors entry_points.offer_id).
ALTER TABLE members         ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id);
ALTER TABLE members_staging ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id);

CREATE INDEX IF NOT EXISTS members_offer_id_idx         ON members         (client_id, offer_id);
CREATE INDEX IF NOT EXISTS members_staging_offer_id_idx ON members_staging (client_id, offer_id);;

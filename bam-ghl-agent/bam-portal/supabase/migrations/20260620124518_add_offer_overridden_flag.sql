ALTER TABLE members_staging ADD COLUMN IF NOT EXISTS offer_overridden boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS offer_overridden boolean NOT NULL DEFAULT false;;

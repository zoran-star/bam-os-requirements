ALTER TABLE members_staging
  ADD COLUMN IF NOT EXISTS coachiq_collecting boolean NOT NULL DEFAULT false;;

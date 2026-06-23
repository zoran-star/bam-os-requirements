ALTER TABLE clients ADD COLUMN IF NOT EXISTS coachiq_signup_url text;
UPDATE clients SET coachiq_signup_url = 'https://app.coachiq.io/bam-gta/athletes'
WHERE coachiq_enabled = true AND coachiq_signup_url IS NULL;;

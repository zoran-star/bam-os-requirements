ALTER TABLE clients ADD COLUMN IF NOT EXISTS sorter_dismissals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS billing_mode text;
ALTER TABLE members_staging ADD COLUMN IF NOT EXISTS billing_mode text;;

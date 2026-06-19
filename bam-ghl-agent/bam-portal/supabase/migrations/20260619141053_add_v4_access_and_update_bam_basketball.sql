
ALTER TABLE clients ADD COLUMN IF NOT EXISTS v4_access boolean DEFAULT false;

UPDATE clients
SET v4_access = true
WHERE id = 'aad50450-c993-4f20-91bb-2209cfe82602';
;

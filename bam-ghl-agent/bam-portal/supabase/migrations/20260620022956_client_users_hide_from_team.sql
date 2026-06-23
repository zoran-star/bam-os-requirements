-- Hide BAM (internal) staff from the client portal's team list. A client_users
-- row is flagged when its login is a BAM staff member (staff table). The client
-- portal team views filter these out so academy owners only see THEIR people.
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS hide_from_team boolean NOT NULL DEFAULT false;

-- Backfill: flag existing memberships whose user_id or email is a BAM staff row.
UPDATE client_users cu
SET hide_from_team = true
WHERE NOT cu.hide_from_team
  AND EXISTS (
    SELECT 1 FROM staff s
    WHERE (s.user_id IS NOT NULL AND s.user_id = cu.user_id)
       OR (s.email IS NOT NULL AND cu.email IS NOT NULL AND lower(s.email) = lower(cu.email))
  );

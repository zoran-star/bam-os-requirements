
-- Per Zoran 2026-05-26: new academies should default to "not in onboarding".
-- Staff explicitly flips the toggle ON when they start onboarding a new
-- client (so the client sees Messages + Members + Tracker widget).
-- Once staff finishes onboarding, they flip OFF, the trimmed nav kicks
-- in, and the first-login tour fires.

ALTER TABLE public.clients
  ALTER COLUMN onboarding_in_progress SET DEFAULT false;
;

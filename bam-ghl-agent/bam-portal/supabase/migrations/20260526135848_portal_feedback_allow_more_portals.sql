
-- The API at /api/clients?action=submit-feedback already accepts
-- portal='signup' (for the public signup form's feedback widget) but the
-- DB check constraint only allowed 'staff' / 'client'. Adding 'signup'
-- to fix the drift, plus 'spec' for the new comment widget on
-- offer-architecture.html (BAM team commenting on the offer spec —
-- comments land in Zoran's Feedback tab same as other portals).

ALTER TABLE public.portal_feedback
  DROP CONSTRAINT IF EXISTS portal_feedback_portal_check;

ALTER TABLE public.portal_feedback
  ADD CONSTRAINT portal_feedback_portal_check
  CHECK (portal = ANY (ARRAY['staff'::text, 'client'::text, 'signup'::text, 'spec'::text]));
;

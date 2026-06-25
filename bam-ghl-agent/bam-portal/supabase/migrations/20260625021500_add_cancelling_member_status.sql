-- The period-end cancel path sets members.status='cancelling' (member stays on
-- the roster until Stripe fires subscription.deleted at period end). The enum was
-- missing this value, so the PATCH threw and the cancel surfaced as an error in the
-- UI (immediate cancels worked because they DELETE the row instead of setting status).
alter type member_status add value if not exists 'cancelling';

-- Confirm initial automations: the booking-confirmation step sends an SMS AND a
-- confirmation EMAIL (same copy). The email payload rides the SAME approval card as
-- the SMS, so approving the touch in Hawkeye sends both. Store the resolved email
-- subject + body on the card. Additive + nullable (null for SMS-only / AI cards).

alter table public.agent_confirm_replies
  add column if not exists email_subject text;
alter table public.agent_confirm_replies
  add column if not exists email_body text;

comment on column public.agent_confirm_replies.email_body is
  'For kind=confirm_auto steps that also email: the resolved confirmation email body, sent alongside the SMS when the card is approved/sent. Null for SMS-only and AI cards.';

-- Missed-call auto text-back: when an inbound call is missed, the caller gets an SMS
-- (via the portal SMS spine, so it threads in the portal inbox, off-GHL).
alter table client_twilio_config add column if not exists missed_call_text_enabled boolean not null default true;
alter table client_twilio_config add column if not exists missed_call_text text;
comment on column client_twilio_config.missed_call_text is 'Custom SMS auto-sent to a caller on a missed inbound call. Null = default copy.';

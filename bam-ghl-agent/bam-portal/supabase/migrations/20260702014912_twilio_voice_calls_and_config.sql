-- Voice/calling for the Twilio spine (mirrors the SMS spine). Cell-forwarding model:
-- inbound rings staff cells; outbound click-to-call bridges staff cell -> lead.
alter table client_twilio_config add column if not exists voice_enabled boolean not null default false;
alter table client_twilio_config add column if not exists voice_ring_numbers text[] not null default '{}';
alter table client_twilio_config add column if not exists voice_record boolean not null default false;
alter table client_twilio_config add column if not exists voicemail_enabled boolean not null default true;
comment on column client_twilio_config.voice_ring_numbers is 'E.164 staff cell numbers to ring on inbound calls (first to answer wins).';

create table if not exists calls (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null,
  direction        text not null check (direction in ('inbound','outbound')),
  status           text,                       -- twilio call status + 'voicemail'
  twilio_call_sid  text unique,
  from_number      text,
  to_number        text,
  contact_phone    text,                        -- the lead/other party, E.164
  ghl_contact_id   text,
  contact_name     text,
  answered_by      text,                        -- staff number that answered (inbound) / was bridged
  duration_seconds integer,
  recording_url    text,                        -- voicemail recording (no call recording for GTA)
  voicemail_transcript text,
  occurred_at      timestamptz not null default now(),
  raw              jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists calls_client_time_idx on calls (client_id, occurred_at desc);
create index if not exists calls_contact_phone_idx on calls (client_id, contact_phone);
create index if not exists calls_ghl_contact_idx on calls (client_id, ghl_contact_id);
alter table calls enable row level security;  -- service-role only (no policies), like sms_messages;

-- Voicemail inbox: track when (and by whom) a voicemail was listened to,
-- so the portal can badge unheard voicemails.
alter table calls add column if not exists heard_at timestamptz;
alter table calls add column if not exists heard_by text;
create index if not exists calls_voicemail_unheard_idx
  on calls (client_id, occurred_at desc)
  where status = 'voicemail' and heard_at is null;

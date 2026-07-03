-- Migration cutover tracking: a client texts via GHL until their port lands
-- and (for US) their A2P campaign verifies - then the watcher flips them.
alter table client_twilio_config add column if not exists a2p_required boolean not null default true;
alter table client_twilio_config add column if not exists a2p_campaign_sid text;
alter table client_twilio_config add column if not exists a2p_status text;
alter table client_twilio_config add column if not exists port_status text;
alter table client_twilio_config add column if not exists auto_cutover boolean not null default true;
alter table client_twilio_config add column if not exists cutover_at timestamptz;
comment on column client_twilio_config.a2p_required is 'US clients: block cutover until the A2P campaign verifies. Set false for CA/AU.';

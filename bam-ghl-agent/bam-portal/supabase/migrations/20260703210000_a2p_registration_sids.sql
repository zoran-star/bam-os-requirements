-- A2P ISV registration chain state (one SID per stage; a stage with a stored
-- SID is skipped on re-run, making register-a2p resumable + idempotent).
alter table client_twilio_config add column if not exists a2p_profile_sid text;        -- BU… secondary customer profile
alter table client_twilio_config add column if not exists a2p_trust_product_sid text;  -- BU… a2p trust product
alter table client_twilio_config add column if not exists a2p_brand_sid text;          -- BN… brand registration
alter table client_twilio_config add column if not exists a2p_submitted_at timestamptz;

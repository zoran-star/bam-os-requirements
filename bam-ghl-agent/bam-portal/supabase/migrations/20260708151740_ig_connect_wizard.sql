-- Instagram connect wizard (client self-serve Meta OAuth through the portal).
-- Mirrors the email wizard's clients.email_setup pattern: one JSONB column on
-- the academy row holding wizard state between the OAuth callback and the page
-- pick, plus display info once wired:
--   { user_token_enc?, pages?: [{page_id,page_name,ig_username}],
--     page_name?, ig_username?, connected_at?, wired_at?, disconnected_at? }
-- The actual messaging wiring still lives in client_meta_messaging_config
-- (page_token_enc, status, inbox_live) - ig_setup is only the wizard's memory.
alter table clients add column if not exists ig_setup jsonb;

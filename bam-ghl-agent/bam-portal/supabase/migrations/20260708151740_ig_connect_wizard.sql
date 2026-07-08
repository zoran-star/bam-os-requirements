-- Instagram connect wizard (client self-serve Meta OAuth through the portal).
-- Mirrors the email wizard's clients.email_setup pattern. Wiring itself lives
-- in client_meta_messaging_config; ig_setup is only the wizard's memory.
alter table clients add column if not exists ig_setup jsonb;

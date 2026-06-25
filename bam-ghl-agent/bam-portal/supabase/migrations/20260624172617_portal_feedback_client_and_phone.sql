-- Attribute feedback to the academy that sent it, and keep the submitter's phone
-- so we can text them when it's resolved.
alter table portal_feedback add column if not exists client_id uuid;
alter table portal_feedback add column if not exists submitter_phone text;
create index if not exists portal_feedback_client_idx on portal_feedback(client_id);

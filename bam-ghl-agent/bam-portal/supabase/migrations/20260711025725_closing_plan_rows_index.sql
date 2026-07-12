-- The closing follow-up PLAN inserts 2-3 followup_N rows for ONE contact in a
-- single batch, but agent_closing_replies_one_active_per_contact was unique on
-- (client_id, ghl_contact_id) for active rows - so EVERY multi-message plan
-- insert 409'd and rolled back whole. Result: no follow-up card ever landed for
-- a quiet Done-Trial lead (found on BAM GTA, 2026-07-10).
--
-- Fix: widen the active-uniqueness key with the step_key so the plan's rows
-- (followup_1 / followup_2 / ...) can coexist, while everything else keeps the
-- one-active-card-per-contact rule (step_key null -> '' bucket), and a duplicate
-- plan still collides on followup_1.
drop index if exists agent_closing_replies_one_active_per_contact;
create unique index if not exists agent_closing_replies_one_active_per_contact
  on agent_closing_replies (client_id, ghl_contact_id, coalesce(step_key, ''))
  where status in ('pending', 'approved');

-- The staff portal "Confirm monthly budgets?" action (api/marketing.js,
-- ClientsCombinedView "Request budget confirmation") creates a marketing_ticket
-- of type 'budget-review' - its own first-class ticket type across the code + UI.
-- The original marketing_tickets type CHECK omitted it, so the insert failed with
-- Postgres 23514 (marketing_tickets_type_check). Add 'budget-review' to the list.
--
-- Idempotent: drop-if-exists then re-add, so fresh local replay and any linked
-- re-push run cleanly. Already applied to the linked project on 2026-06-30.
alter table public.marketing_tickets
  drop constraint if exists marketing_tickets_type_check;

alter table public.marketing_tickets
  add constraint marketing_tickets_type_check
  check (type in ('replace', 'add', 'remove', 'budget', 'campaign-create', 'budget-review'));

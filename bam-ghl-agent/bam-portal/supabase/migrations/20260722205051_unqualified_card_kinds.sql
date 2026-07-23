-- Opt-out → mark-unqualified suggestion cards (2026-07-21 team meeting).
-- The agents can now SUGGEST removing an opted-out lead ("stop talking to me",
-- "leave me alone") from the pipeline as unqualified - approving runs the
-- existing confirm-abandoned path (no nurture, no goodbye, unqualified tag).
-- New card kinds per agent queue:
--   agent_ready_replies    → kind='mark_unqualified'    (no kind CHECK on this table)
--   agent_confirm_replies  → kind='confirm_unqualified'
--   agent_closing_replies  → kind='closing_unqualified'
-- Widen the confirm/closing kind CHECKs to accept them.

alter table public.agent_confirm_replies
  drop constraint if exists agent_confirm_replies_kind_check;
alter table public.agent_confirm_replies
  add constraint agent_confirm_replies_kind_check
  check (kind in ('confirm','confirm_handoff','confirm_lost','confirm_auto','confirm_unqualified','reignite','reignite_due'));

alter table public.agent_closing_replies
  drop constraint if exists agent_closing_replies_kind_check;
alter table public.agent_closing_replies
  add constraint agent_closing_replies_kind_check
  check (kind in ('closing','closing_enroll','closing_lost','closing_auto','closing_unqualified','reignite','reignite_due'));

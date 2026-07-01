-- Confirm agent INITIAL AUTOMATIONS: the scripted first-touch sequence that fires
-- when a lead lands in the Scheduled-Trial stage (booking confirmation, day-before
-- reminder, morning-of reminder). These ride the existing agent_confirm_replies
-- queue as a new card kind so the inbox + approve/send + quiet-hours flush all work
-- unchanged.
--
--   kind='confirm_auto' → a rendered SCRIPTED reminder (template, no AI). step_key
--                         identifies which step of the sequence it is, so the
--                         detector never re-fires the same step to the same lead.
--
-- Additive + backward-compatible: a nullable column + a widened CHECK. Nothing about
-- the existing 'confirm' / 'confirm_handoff' / 'confirm_lost' behavior changes.

-- 1) widen the kind CHECK to include 'confirm_auto' (the inline constraint has an
--    auto-generated name; drop it by introspection, then re-add a named one).
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.agent_confirm_replies'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if cname is not null then
    execute format('alter table public.agent_confirm_replies drop constraint %I', cname);
  end if;
end $$;

alter table public.agent_confirm_replies
  add constraint agent_confirm_replies_kind_check
  check (kind in ('confirm', 'confirm_handoff', 'confirm_lost', 'confirm_auto'));

-- 2) which scripted step a card represents (null for AI 'confirm'/handoff/lost cards).
alter table public.agent_confirm_replies
  add column if not exists step_key text;

-- Fast lookup of which scripted steps already fired for a contact (detector dedupe).
create index if not exists agent_confirm_replies_stepkey_idx
  on public.agent_confirm_replies (client_id, ghl_contact_id, step_key)
  where step_key is not null;

comment on column public.agent_confirm_replies.step_key is
  'For kind=confirm_auto: which step of the confirm initial-automation sequence (confirm/day_before/morning_of). Dedupes scripted sends per contact.';

-- Closing agent INITIAL AUTOMATIONS: the scripted post-trial follow-up sequence that
-- fires when a good-fit attendee lands in the Done-Trial stage (post-trial follow-up,
-- +2-day nudge, +4-day close-out). These ride the existing agent_closing_replies
-- queue as a new card kind so the inbox + approve/send + quiet-hours flush all work
-- unchanged.
--
--   kind='closing_auto' → a rendered SCRIPTED nudge (template, no AI). step_key
--                         identifies which step it is, so the detector never
--                         re-fires the same step to the same lead.
--
-- Additive + backward-compatible: a nullable column + a widened CHECK. Nothing about
-- the existing 'closing' / 'closing_enroll' / 'closing_lost' behavior changes.

do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.agent_closing_replies'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if cname is not null then
    execute format('alter table public.agent_closing_replies drop constraint %I', cname);
  end if;
end $$;

alter table public.agent_closing_replies
  add constraint agent_closing_replies_kind_check
  check (kind in ('closing', 'closing_enroll', 'closing_lost', 'closing_auto'));

alter table public.agent_closing_replies
  add column if not exists step_key text;

create index if not exists agent_closing_replies_stepkey_idx
  on public.agent_closing_replies (client_id, ghl_contact_id, step_key)
  where step_key is not null;

comment on column public.agent_closing_replies.step_key is
  'For kind=closing_auto: which step of the closing post-trial sequence (post_trial/nudge/closeout). Dedupes scripted sends per contact.';

-- automation_steps.sync_class: may this step's content travel to another academy?
--
-- Academies share one preset of automated messages (seedAutomations copies the
-- canonical defaults into every academy). Some of that content must NEVER be
-- copied: real parent testimonials, which {{location.city}} silently
-- re-attributes to whichever academy sends them. A near-miss shipped exactly
-- that. The weekly drift checker that would have caught a mis-marking was
-- cancelled in favour of this structural marking, so this column plus
-- api/_sync-class.js is the only mechanism preventing that class of bug.
--
--   shared      generic/tokenized brand copy - safe to copy to any academy (default)
--   local       academy-specific literals (that academy's phone, links, city)
--   attributed  carries a real person's words tied to a real place - never copy
--
-- Resolution (api/_sync-class.js): the STRICTEST wins,
-- attributed > local > shared. A step whose body is 'template:<key>' also
-- inherits the TEMPLATE's class (api/email-templates/sync-classes.js), and this
-- column can only make a step STRICTER, never looser. A row saying 'shared'
-- pointing at an attributed template resolves to 'attributed'.
--
-- Default 'shared' is safe ONLY because the resolver, not this column, has the
-- last word on template-backed bodies.

alter table public.automation_steps
  add column if not exists sync_class text not null default 'shared';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_steps_sync_class_check'
      and conrelid = 'public.automation_steps'::regclass
  ) then
    alter table public.automation_steps
      add constraint automation_steps_sync_class_check
      check (sync_class in ('shared', 'local', 'attributed'));
  end if;
end $$;

comment on column public.automation_steps.sync_class is
  'May this step''s content be copied to another academy? shared (default) | local | attributed. Effective class = STRICTEST of this value and the referenced template''s class (api/_sync-class.js). This column can only make a step stricter, never looser.';

-- Sales Flow: three flow-graph changes from the 2026-07-21 team meeting
-- (Zoran-approved), plus the contact entry-point stage fix.
--
--   1. scheduled_trial --cancel_booking--> responded
--        A lead who cancels their booked trial in the calendar goes back to the
--        booking agent to rebook (mirrors the cant_make_it handoff).
--   2. done_trial --ghosted_ran_out--> nurture
--        A lead who ghosts all of the closing agent's post-trial follow-ups
--        rolls into the Nurture long game (they never said no - they went quiet).
--   3. nurture --ghosted_ran_out--> @unqualified
--        A lead who completes the ENTIRE nurture sequence without ever replying
--        exits the pipeline as unqualified. Reuses the existing "sequence ran
--        out" trigger idiom from the interested stage - no second enum value.
--   4. entry_points: the contact form lands leads in RESPONDED, not 'interested'.
--
-- Requires 20260721120000_cancel_booking_trigger_value.sql (the enum value must
-- be committed before it can be used here). Mirrors api/agent/presets.js
-- PRESETS.free_trial - the code registry stays the source of truth; this keeps
-- the SQL seed function + already-seeded clients in sync with it.

-- ── 1. seed function: academies seeded from now on get the new edges ──
create or replace function public.seed_default_stage_transitions(p_client_id uuid) returns void as $$
begin
  insert into public.stage_transitions
    (client_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
  values
    -- Responded (Booking agent)
    (p_client_id, null,             'new_lead',            'stage',    'responded',       null,          true, 10),
    (p_client_id, 'responded',      'booked',              'stage',    'scheduled_trial', null,          true, 11),
    (p_client_id, 'responded',      'not_interested',      'stage',    'nurture',         null,          true, 12),
    (p_client_id, 'responded',      'marked_unqualified',  'terminal', null,              'unqualified', true, 13),
    (p_client_id, 'responded',      'went_quiet',          'stage',    'interested',      null,          true, 14),
    (p_client_id, 'responded',      'complaint_offtopic',  'terminal', null,              'human',       true, 15),
    -- Scheduled Trial (Confirm agent) + post-trial-form router outcomes
    (p_client_id, 'scheduled_trial','post_trial_good_fit', 'stage',    'done_trial',      null,          true, 20),
    (p_client_id, 'scheduled_trial','post_trial_not_fit',  'terminal', null,              'unqualified', true, 21),
    (p_client_id, 'scheduled_trial','no_show',             'stage',    'responded',       null,          true, 22),
    (p_client_id, 'scheduled_trial','cant_make_it',        'stage',    'responded',       null,          true, 23),
    (p_client_id, 'scheduled_trial','no_longer_wants',     'stage',    'nurture',         null,          true, 24),
    (p_client_id, 'scheduled_trial','marked_unqualified',  'terminal', null,              'unqualified', true, 25),
    (p_client_id, 'scheduled_trial','complaint_offtopic',  'terminal', null,              'human',       true, 26),
    -- Lead cancels their booked trial in the calendar -> booking agent rebooks
    (p_client_id, 'scheduled_trial','cancel_booking',      'stage',    'responded',       null,          true, 27),
    -- Done Trial (Closing agent)
    (p_client_id, 'done_trial',     'enrolls',             'terminal', null,              'member',      true, 30),
    (p_client_id, 'done_trial',     'says_no',             'stage',    'nurture',         null,          true, 31),
    (p_client_id, 'done_trial',     'marked_unqualified',  'terminal', null,              'unqualified', true, 32),
    (p_client_id, 'done_trial',     'complaint_offtopic',  'terminal', null,              'human',       true, 33),
    -- Ghosts all closing follow-ups after the trial -> Nurture long game
    (p_client_id, 'done_trial',     'ghosted_ran_out',     'stage',    'nurture',         null,          true, 34),
    -- Interested (Ghosted automation)
    (p_client_id, 'interested',     'replied',             'stage',    'responded',       null,          true, 40),
    (p_client_id, 'interested',     'ghosted_ran_out',     'stage',    'nurture',         null,          true, 41),
    -- Nurture (Lead Nurture automation)
    (p_client_id, 'nurture',        'replied',             'stage',    'responded',       null,          true, 50),
    -- Completes the entire nurture sequence without replying -> unqualified
    (p_client_id, 'nurture',        'ghosted_ran_out',     'terminal', null,              'unqualified', true, 51)
  on conflict on constraint stage_transitions_edge_uniq do nothing;
end $$ language plpgsql;

-- ── 2. backfill: clients that already carry the seeded free-trial flow ──
-- Keyed off a signature edge each stage already has, copying that edge's
-- client/offer/pipeline scoping so per-offer preset stamps stay per-offer.
-- Idempotent: the edge unique is NULLS NOT DISTINCT, so re-running is a no-op.

-- 2a. scheduled_trial --cancel_booking--> responded (signature: cant_make_it)
insert into public.stage_transitions
  (client_id, offer_id, pipeline_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
select distinct st.client_id, st.offer_id, st.pipeline_id,
       'scheduled_trial', 'cancel_booking'::transition_trigger, 'stage'::transition_destination_kind, 'responded', null, true, 27
  from public.stage_transitions st
 where st.from_stage_role = 'scheduled_trial'
   and st.trigger = 'cant_make_it'
   and st.to_kind = 'stage'
   and st.to_stage_role = 'responded'
on conflict on constraint stage_transitions_edge_uniq do nothing;

-- 2b. done_trial --ghosted_ran_out--> nurture (signature: says_no)
insert into public.stage_transitions
  (client_id, offer_id, pipeline_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
select distinct st.client_id, st.offer_id, st.pipeline_id,
       'done_trial', 'ghosted_ran_out'::transition_trigger, 'stage'::transition_destination_kind, 'nurture', null, true, 34
  from public.stage_transitions st
 where st.from_stage_role = 'done_trial'
   and st.trigger = 'says_no'
   and st.to_kind = 'stage'
   and st.to_stage_role = 'nurture'
on conflict on constraint stage_transitions_edge_uniq do nothing;

-- 2c. nurture --ghosted_ran_out--> @unqualified (signature: replied)
insert into public.stage_transitions
  (client_id, offer_id, pipeline_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
select distinct st.client_id, st.offer_id, st.pipeline_id,
       'nurture', 'ghosted_ran_out'::transition_trigger, 'terminal'::transition_destination_kind, null, 'unqualified', true, 51
  from public.stage_transitions st
 where st.from_stage_role = 'nurture'
   and st.trigger = 'replied'
   and st.to_kind = 'stage'
   and st.to_stage_role = 'responded'
on conflict on constraint stage_transitions_edge_uniq do nothing;

-- ── 3. contact entry point lands in RESPONDED, not the Ghosted/interested stage ──
-- The contact form is a front-door entry: the booking agent works Responded, so
-- dropping contact leads into 'interested' parked them where only the ghost
-- automation watches. Point existing contact rows at the responded stage
-- (idempotent - the filter no longer matches once updated). The local seed
-- (seeds/20_bam_gta_entry_points.sql) is fixed in the same commit.
update public.entry_points
   set stage_name = 'responded', updated_at = now()
 where type = 'website-form'
   and key = 'contact'
   and lower(coalesce(stage_name, '')) = 'interested';

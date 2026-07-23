-- Defensive follow-up to 20260721150552_rename_interested_stage_to_ghosted.
-- The legacy seed_default_stage_transitions() SQL function (from migration
-- 20260706122103) is DEAD - scripts/apply-preset.mjs + api/agent/presets.js
-- (applyPreset, station model 2026-07-14) replaced it and nothing calls it. But it
-- still emits the old 'interested' role, so a manual call would reintroduce it.
-- Re-point it at 'ghosted' so the whole DB is consistent. Same constraint name
-- (stage_transitions_edge_uniq) as the offer_id migration preserved.
--
-- NOTE (2026-07-23): reconstructed from the live database - applied to prod via
-- MCP on 2026-07-21 but never committed. Body verbatim from
-- supabase_migrations.schema_migrations.
create or replace function public.seed_default_stage_transitions(p_client_id uuid) returns void as $$
begin
  insert into public.stage_transitions
    (client_id, from_stage_role, trigger, to_kind, to_stage_role, to_terminal, is_seed, sort_order)
  values
    (p_client_id, null,             'new_lead',            'stage',    'responded',       null,          true, 10),
    (p_client_id, 'responded',      'booked',              'stage',    'scheduled_trial', null,          true, 11),
    (p_client_id, 'responded',      'not_interested',      'stage',    'nurture',         null,          true, 12),
    (p_client_id, 'responded',      'marked_unqualified',  'terminal', null,              'unqualified', true, 13),
    (p_client_id, 'responded',      'went_quiet',          'stage',    'ghosted',         null,          true, 14),
    (p_client_id, 'responded',      'complaint_offtopic',  'terminal', null,              'human',       true, 15),
    (p_client_id, 'scheduled_trial','post_trial_good_fit', 'stage',    'done_trial',      null,          true, 20),
    (p_client_id, 'scheduled_trial','post_trial_not_fit',  'terminal', null,              'unqualified', true, 21),
    (p_client_id, 'scheduled_trial','no_show',             'stage',    'responded',       null,          true, 22),
    (p_client_id, 'scheduled_trial','cant_make_it',        'stage',    'responded',       null,          true, 23),
    (p_client_id, 'scheduled_trial','no_longer_wants',     'stage',    'nurture',         null,          true, 24),
    (p_client_id, 'scheduled_trial','marked_unqualified',  'terminal', null,              'unqualified', true, 25),
    (p_client_id, 'scheduled_trial','complaint_offtopic',  'terminal', null,              'human',       true, 26),
    (p_client_id, 'done_trial',     'enrolls',             'terminal', null,              'member',      true, 30),
    (p_client_id, 'done_trial',     'says_no',             'stage',    'nurture',         null,          true, 31),
    (p_client_id, 'done_trial',     'marked_unqualified',  'terminal', null,              'unqualified', true, 32),
    (p_client_id, 'done_trial',     'complaint_offtopic',  'terminal', null,              'human',       true, 33),
    (p_client_id, 'ghosted',        'replied',             'stage',    'responded',       null,          true, 40),
    (p_client_id, 'ghosted',        'ghosted_ran_out',     'stage',    'nurture',         null,          true, 41),
    (p_client_id, 'nurture',        'replied',             'stage',    'responded',       null,          true, 50)
  on conflict on constraint stage_transitions_edge_uniq do nothing;
end $$ language plpgsql;

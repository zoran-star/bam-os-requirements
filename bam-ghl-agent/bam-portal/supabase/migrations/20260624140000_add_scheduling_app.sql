-- Per-academy scheduling-app choice ('coachiq' | 'none'). Drives coachiq_enabled
-- so all existing CoachIQ gates follow. Backfilled from coachiq_enabled.
alter table clients add column if not exists scheduling_app text not null default 'none';
update clients set scheduling_app = case when coachiq_enabled is true then 'coachiq' else 'none' end;

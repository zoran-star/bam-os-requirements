-- Transition bridge flag: cron-sync-pipeline mirrors GHL board changes into the
-- opportunities store for academies whose GHL workflows still create/move cards
-- while pipeline_provider='portal' (DETAIL Miami). Applied to prod 2026-07-08.
alter table clients add column if not exists pipeline_ghl_mirror boolean not null default false;
comment on column clients.pipeline_ghl_mirror is 'Transition bridge: when true (+ pipeline_provider=portal), cron-sync-pipeline mirrors GHL board changes into the opportunities store. For academies whose GHL workflows still create/move cards (DETAIL Miami). Off for academies fully portal-native (GTA).';

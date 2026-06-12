-- Stop the auto-create-on-Blueprint-completion. The systems ticket is now
-- created manually by staff via the 'Trigger systems buildout' onboarding step.
drop trigger if exists trg_systems_onboarding_ticket on public.clients;

-- Timestamp for the staff-only trigger_buildout onboarding step.
alter table public.clients add column if not exists systems_buildout_triggered_at timestamptz;;

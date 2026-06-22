-- The staff.role CHECK constraint (staff_role_check) enumerates allowed roles and
-- did NOT include the new content_executor role added in 20260619150000's feature,
-- so inviting a Content Executor failed with a staff_role_check violation.
-- Rebuild the constraint to cover every known staff role incl. content_executor.
-- Idempotent (drop-if-exists then add). Keep this list in sync with ANY_STAFF_ROLES
-- in api/_roles.js.
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in (
    'admin',
    'scaling_manager',
    'marketing_manager',
    'marketing_executor',
    'content_executor',
    'systems_manager',
    'systems_executor',
    'systems'
  ));

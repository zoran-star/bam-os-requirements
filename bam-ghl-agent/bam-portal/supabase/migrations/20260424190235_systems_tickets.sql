-- Expand staff role constraint
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('admin','systems','marketing','sm','staff',
                  'systems_manager','systems_executor'));

-- Expand tickets status
alter table tickets drop constraint if exists tickets_status_check;
alter table tickets add constraint tickets_status_check
  check (status in ('open','delegated','in_progress','awaiting_client',
                    'in_review','needs_rework','approved','done'));

-- New columns
alter table tickets add column if not exists delegated_by uuid references staff(id);
alter table tickets add column if not exists delegated_at timestamptz;
alter table tickets add column if not exists client_action_request text;
alter table tickets add column if not exists client_action_response text;
alter table tickets add column if not exists client_action_files jsonb default '[]'::jsonb;
alter table tickets add column if not exists user_guide text;
alter table tickets add column if not exists denial_notes text;

create index if not exists tickets_status_idx       on tickets(status);
create index if not exists tickets_assigned_to_idx  on tickets(assigned_to);
create index if not exists tickets_client_id_idx    on tickets(client_id);

-- Cleanup existing test rows
delete from tickets where submitted_at < now() - interval '1 hour';

-- Authenticated staff can read all tickets
drop policy if exists "staff_select_all_tickets" on tickets;
create policy "staff_select_all_tickets" on tickets
  for select to authenticated using (true);;

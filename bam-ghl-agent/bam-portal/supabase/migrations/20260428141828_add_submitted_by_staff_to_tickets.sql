alter table tickets add column if not exists submitted_by_staff uuid references staff(id) on delete set null;;

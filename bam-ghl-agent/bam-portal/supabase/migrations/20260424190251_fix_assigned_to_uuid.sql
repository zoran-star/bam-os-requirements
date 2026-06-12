alter table tickets alter column assigned_to type uuid using assigned_to::uuid;
alter table tickets add constraint tickets_assigned_to_fkey foreign key (assigned_to) references staff(id);;

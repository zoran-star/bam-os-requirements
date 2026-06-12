alter table clients add column if not exists email text;
create index if not exists clients_email_idx on clients(email);;

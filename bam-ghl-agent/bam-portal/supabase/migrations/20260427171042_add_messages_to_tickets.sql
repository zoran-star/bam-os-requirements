alter table tickets add column if not exists messages jsonb default '[]'::jsonb not null;
create index if not exists tickets_messages_gin on tickets using gin (messages);;

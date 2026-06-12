alter table public.playground_todos
  add column if not exists depth int not null default 0;;

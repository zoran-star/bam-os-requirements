-- Let one todo-style table back multiple boards (TODO, CONTENT IDEAS, ...).
alter table public.playground_todos add column if not exists board text not null default 'todo';
alter table public.playground_widgets add column if not exists board text not null default 'todo';

-- Existing TODO card opens the 'todo' board (already the default).
update public.playground_widgets set board = 'todo' where type = 'todo' and title = 'TODO';

-- New CONTENT IDEAS card (same todo widget type, different board).
insert into public.playground_widgets (type, board, title, x, y, w, h)
values ('todo', 'content', 'CONTENT IDEAS', 380, 320, 280, 340);

-- Seed it with one starter section so the format is visible.
insert into public.playground_todos (board, section, section_position, label, position) values
  ('content', 'ideas', 0, 'first idea', 0);;

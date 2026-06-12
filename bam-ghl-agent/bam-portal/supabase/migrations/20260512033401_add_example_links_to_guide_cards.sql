alter table public.guide_cards
  add column example_links jsonb not null default '[]'::jsonb;

comment on column public.guide_cards.example_links is
  'Array of { url, label } — external links Cam adds to inspirations / examples';;

alter table public.marketing_tickets
  add column if not exists awaiting_revision boolean not null default false;

comment on column public.marketing_tickets.awaiting_revision is
  'True when marketing has sent a revision request back to content. Hidden from Active until the content team completes the revision and re-sends.';

create index if not exists marketing_tickets_awaiting_revision_idx
  on public.marketing_tickets(awaiting_revision) where awaiting_revision = true;;

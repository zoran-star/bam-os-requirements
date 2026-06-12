alter table public.content_tickets drop constraint content_tickets_type_check;
alter table public.content_tickets
  add constraint content_tickets_type_check check (type in ('graphic','video','mixed'));

comment on column public.content_tickets.type is
  'graphic | video | mixed. Mixed is used for new-campaign mega-tickets that bundle multiple sub-creatives in context.creatives.';;

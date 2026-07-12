create table if not exists public.stripe_link_reviews (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  stripe_customer_id text not null,
  customer           jsonb,
  candidates         jsonb,
  status             text not null default 'pending' check (status in ('pending','linked','skipped')),
  decided_contact    text,
  decided_by         text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  unique (client_id, stripe_customer_id)
);

create index if not exists stripe_link_reviews_pending_idx
  on public.stripe_link_reviews (client_id, status) where status = 'pending';

comment on table public.stripe_link_reviews is
  'Ambiguous Stripe-customer -> portal-contact matches awaiting staff review (Stripe Link-Up tool). Auto-links and orphan creations do not land here - only cases needing a human call.';

alter table public.stripe_link_reviews enable row level security;

drop policy if exists stripe_link_reviews_staff_read on public.stripe_link_reviews;
create policy stripe_link_reviews_staff_read on public.stripe_link_reviews
  for select using (public.is_staff());

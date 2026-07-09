-- Stripe-contact link cleanup (staff side): review queue for AMBIGUOUS matches.
--
-- The sweep (api/contacts/stripe-link.js) walks every Stripe customer on an
-- academy's connected account:
--   exact-email single match  -> auto-link silently (stamps contacts.stripe_customer_id)
--   ambiguous (phone/name/multi-email/conflict) -> a row HERE for staff review
--   no match at all           -> contact created (source='stripe-import')
-- Staff decide each pending row (Link / Skip) from the staff portal's
-- "Stripe Link-Up" view. Decided rows persist so re-sweeps don't re-surface them.

create table if not exists public.stripe_link_reviews (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  stripe_customer_id text not null,
  customer           jsonb,            -- { name, email, phone, created_iso } snapshot from Stripe
  candidates         jsonb,            -- [ { ghl_contact_id, name, email, phone, reason } ]
  status             text not null default 'pending' check (status in ('pending','linked','skipped')),
  decided_contact    text,             -- ghl_contact_id chosen on Link
  decided_by         text,             -- staff name/email
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  unique (client_id, stripe_customer_id)
);

create index if not exists stripe_link_reviews_pending_idx
  on public.stripe_link_reviews (client_id, status) where status = 'pending';

comment on table public.stripe_link_reviews is
  'Ambiguous Stripe-customer -> portal-contact matches awaiting staff review (Stripe Link-Up tool). Auto-links and orphan creations do not land here - only cases needing a human call.';

-- Staff tool: staff-only read; writes go through the API (service role).
alter table public.stripe_link_reviews enable row level security;

drop policy if exists stripe_link_reviews_staff_read on public.stripe_link_reviews;
create policy stripe_link_reviews_staff_read on public.stripe_link_reviews
  for select using (public.is_staff());

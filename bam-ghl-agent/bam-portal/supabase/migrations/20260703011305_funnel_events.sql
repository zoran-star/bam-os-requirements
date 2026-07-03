-- Website funnel analytics (offer tie-in follow-up): step-by-step events from
-- the public funnel pages (free trial, enroll). Answers: where do people drop
-- off, which ads produced them (utm), and is the calendar the bottleneck.
-- Written ONLY by the service-role beacon endpoint; staff read via RLS.
create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  offer_id uuid references public.offers(id),
  funnel text not null,             -- 'free-trial' | 'enroll' (entry point key)
  step text not null,               -- page_view | form_started | form_completed
                                    -- | calendar_viewed | slot_picked | confirmed
                                    -- | plan_viewed | plan_picked | payment_started | paid
  session_id text,                  -- anonymous per-visit id from the page
  url text,
  referrer text,
  utm jsonb,                        -- { source, medium, campaign, content, term, fbclid }
  meta jsonb,
  created_at timestamptz not null default now()
);
create index ix_funnel_events_client_funnel on public.funnel_events (client_id, funnel, step, created_at);
create index ix_funnel_events_session on public.funnel_events (client_id, session_id);
alter table public.funnel_events enable row level security;
create policy funnel_events_select on public.funnel_events
  for select using (is_staff() or client_id in (select my_client_ids()));
-- writes: service-role beacon endpoint only (deliberately no insert policy)

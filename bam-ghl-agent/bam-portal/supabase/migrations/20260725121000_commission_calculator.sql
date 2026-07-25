-- Commission & BAM Payment Calculator (Mike / BAM spec, 2026-07-25).
-- Built off the Scaling System Partner Agreement (growth-share clause).
--
-- Payment terms live on the client record; each monthly cycle produces one
-- commission_cycles snapshot keyed to the client's OWN subscription renewal
-- date (July 25 -> Aug 25 -> Sep 25...), invoiced via Stripe at cycle close.
-- Reporting/SM payout is batched separately (3 business days before the 1st
-- and the 15th, Eastern). Engine + report mailer: api/commissions.js.
--
-- Assigned SM = the existing clients.scaling_manager_id (staff row with
-- role 'scaling_manager') - no new SM link column needed.

-- ── Payment terms on the client record ─────────────────────────────────────
alter table public.clients add column if not exists payment_model text
  check (payment_model in ('flat_retainer', 'growth_percentage'));
-- Flat Retainer: fixed monthly fee, no growth math, no SM commission.
alter table public.clients add column if not exists flat_amount numeric;
-- Growth Percentage terms (Agreement defaults: $599 base retainer).
alter table public.clients add column if not exists base_retainer numeric default 599;
-- Agreement §2: Partner's avg monthly revenue pre-engagement. LOCKED for
-- 9 months (per Mike - supersedes the template's 6-month minimum); manually
-- re-entered when the agreement renews. baseline_locked_until enforces it.
alter table public.clients add column if not exists baseline_revenue numeric;
alter table public.clients add column if not exists baseline_locked_until date;
alter table public.clients add column if not exists growth_share_pct numeric;
-- Anchors the monthly calc cycle for this client (their own signup date).
alter table public.clients add column if not exists subscription_renewal_date date;
-- Which integration supplies gross revenue (Agreement §4). 'stripe_connect'
-- uses the academy's connected Stripe account; 'ghl' is reserved.
alter table public.clients add column if not exists revenue_integration_connection text;

-- ── Monthly snapshot: one row per client per cycle ──────────────────────────
create table if not exists public.commission_cycles (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  cycle_date          date not null,   -- cycle CLOSE date (the renewal anniversary)
  cycle_start         date,
  payment_model       text,
  gross_revenue       numeric,         -- raw gross from the integration (no refund netting)
  baseline_revenue    numeric,
  growth_amount       numeric,         -- max(0, gross - baseline)
  growth_share_pct    numeric,
  growth_share_fee    numeric,         -- pct x growth ("BAM commission")
  base_retainer       numeric,
  total_bam_payment   numeric,         -- retainer + fee (flat: flat_amount)
  sm_staff_id         uuid references public.staff(id) on delete set null,
  sm_commission       numeric,         -- $250 + 25% x fee, only when growth > 0
  invoice_id          text,            -- Stripe invoice id
  invoice_status      text,
  -- Reporting/payout batch (decoupled from invoicing): renewal on the
  -- 1st-15th -> 'fifteenth' batch; 16th-EOM -> 'first' (of next month).
  payout_batch        text check (payout_batch in ('first', 'fifteenth')),
  report_sent_at      timestamptz,
  revenue_pull_status text check (revenue_pull_status in ('success', 'failed')),
  revenue_pull_error  text,            -- failure detail -> Mike+Cole alert
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, cycle_date)
);

create index if not exists commission_cycles_client_idx on public.commission_cycles (client_id, cycle_date desc);
create index if not exists commission_cycles_unreported_idx on public.commission_cycles (payout_batch, report_sent_at);

create or replace function public.touch_commission_cycles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_commission_cycles_updated_at on public.commission_cycles;
create trigger trg_commission_cycles_updated_at
  before update on public.commission_cycles
  for each row execute function public.touch_commission_cycles_updated_at();

-- RLS: STAFF ONLY - clients never see commission figures. Admin sees all;
-- an SM sees only their own assigned clients' cycles (my_client_ids() maps a
-- scaling manager to their clients). Writes go through the service-role API;
-- direct writes are admin-only defense-in-depth.
alter table public.commission_cycles enable row level security;

drop policy if exists commission_cycles_staff_read on public.commission_cycles;
create policy commission_cycles_staff_read on public.commission_cycles
  for select to authenticated
  using (
    public.is_staff()
    and (public.is_admin_staff() or client_id in (select public.my_client_ids()))
  );

drop policy if exists commission_cycles_admin_write on public.commission_cycles;
create policy commission_cycles_admin_write on public.commission_cycles
  for all to authenticated
  using (public.is_admin_staff())
  with check (public.is_admin_staff());

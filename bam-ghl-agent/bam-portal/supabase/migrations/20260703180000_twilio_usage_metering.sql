-- Per-academy Twilio usage, synced daily from the Usage Records API.
-- Foundation for rebilling: usage + markup -> monthly Stripe line item.
create table if not exists twilio_usage (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null,
  usage_date   date not null,
  category     text not null,          -- twilio usage category (sms, calls, phonenumbers, ...)
  count        numeric,                -- units (messages, minutes, numbers)
  usage_usd    numeric not null,       -- twilio's price for the day
  account_sid  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, usage_date, category)
);
create index if not exists twilio_usage_client_month_idx on twilio_usage (client_id, usage_date desc);
alter table twilio_usage enable row level security;
comment on table twilio_usage is 'Daily Twilio spend per academy (master subaccounts + own-account academies like GTA). Service role only.';

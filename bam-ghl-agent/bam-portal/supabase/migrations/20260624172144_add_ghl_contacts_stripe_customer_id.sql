-- Cache the resolved Stripe customer id on the contact mirror so we don't
-- re-search Stripe every view, and the link survives email changes.
alter table ghl_contacts add column if not exists stripe_customer_id text;
create index if not exists ghl_contacts_stripe_customer_idx on ghl_contacts(client_id, stripe_customer_id);

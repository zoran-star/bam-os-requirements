alter table members add column if not exists start_date date;
comment on column members.start_date is 'Membership start date the parent chose at enrollment (display/access label; does NOT change Stripe billing cycle). Null = started immediately (falls back to joined_date). Also stored as Stripe subscription metadata[start_date]. Editable by staff.';;

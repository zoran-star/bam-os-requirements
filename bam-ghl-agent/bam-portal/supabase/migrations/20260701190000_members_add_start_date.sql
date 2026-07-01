-- Membership start date the parent chooses at enrollment. Display/access label only:
-- it does NOT change the Stripe billing cycle (the parent pays + goes live at signup).
-- Null = starts immediately (member card falls back to joined_date). Also mirrored to
-- the Stripe subscription as metadata[start_date]. Editable by staff.
alter table members add column if not exists start_date date;
comment on column members.start_date is 'Membership start date chosen at enrollment (display/access label; not a billing change). Null = immediate. Mirrored to Stripe sub metadata[start_date].';

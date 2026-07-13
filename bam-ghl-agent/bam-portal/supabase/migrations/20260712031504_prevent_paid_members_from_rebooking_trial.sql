-- Pausing a paid membership suspends academy_memberships and entitlements.
-- Trial eligibility must not interpret that temporary suspension as a new,
-- planless child. Keep the invariant at the table boundary so every caller of
-- book_trial_slot receives the same protection.

create or replace function public.prevent_paid_member_parent_app_trial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(coalesce(new.source, '')) = 'parent_app'
     and new.student_id is not null
     and exists (
       select 1
       from public.member_links ml
       join public.members m on m.id = ml.member_id
       where ml.student_id = new.student_id
         and m.client_id = new.tenant_id
         and m.stripe_subscription_id is not null
         and m.status in ('live', 'paused', 'payment_failed', 'cancelling')
     )
  then
    raise exception 'Student already has a paid membership.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_paid_member_parent_app_trial
  on public.trial_bookings;

create trigger trg_prevent_paid_member_parent_app_trial
  before insert on public.trial_bookings
  for each row execute function public.prevent_paid_member_parent_app_trial();

revoke all on function public.prevent_paid_member_parent_app_trial() from public, anon, authenticated;

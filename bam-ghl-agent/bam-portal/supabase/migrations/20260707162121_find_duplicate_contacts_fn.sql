create or replace function find_duplicate_contacts(p_client uuid, p_contact text)
returns table(ghl_contact_id text, name text, phone text, email text, msgs bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select right(regexp_replace(coalesce(phone,''),'\D','','g'), 10) as p10,
           lower(trim(coalesce(name,''))) as nm
    from contacts
    where client_id = p_client and ghl_contact_id = p_contact
  )
  select c.ghl_contact_id, c.name, c.phone, c.email,
    (select count(*) from sms_threads t where t.client_id = p_client and t.ghl_contact_id = c.ghl_contact_id) as msgs
  from contacts c, me
  where c.client_id = p_client
    and c.ghl_contact_id is not null
    and c.ghl_contact_id <> p_contact
    and (
      (length(me.p10) = 10 and right(regexp_replace(coalesce(c.phone,''),'\D','','g'), 10) = me.p10)
      or (me.nm <> '' and lower(trim(coalesce(c.name,''))) = me.nm)
    )
  order by c.name nulls last
  limit 25;
$$;

revoke execute on function find_duplicate_contacts(uuid, text) from anon, authenticated;

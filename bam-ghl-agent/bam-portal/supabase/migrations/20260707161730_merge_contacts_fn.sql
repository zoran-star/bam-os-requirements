create or replace function merge_contacts(p_client uuid, p_keep text, p_drop text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_uuid uuid;
  drop_uuid uuid;
  t text;
  n bigint;
  moved jsonb := '{}'::jsonb;
  ghl_client_tables text[] := array[
    'agent_approvals','agent_closing_replies','agent_confirm_replies','agent_contact_notes',
    'agent_followups','agent_mutes','agent_ready_replies','calls','dm_threads','email_threads',
    'ghl_inbound_messages','inbox_message_log','kpi_events','kpi_manual_cancellations',
    'members','opportunities','post_trial_escalations','post_trial_reviews','sms_threads','website_leads'
  ];
  cid_client_tables text[] := array[
    'automation_enrollments','automation_events','automation_jobs','ghl_funnel_events','mass_send_recipients'
  ];
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    return jsonb_build_object('error','keep and drop must differ');
  end if;

  select id into keep_uuid from contacts where client_id = p_client and ghl_contact_id = p_keep;
  select id into drop_uuid from contacts where client_id = p_client and ghl_contact_id = p_drop;

  -- contact_trainers PK(client_id, ghl_contact_id): drop the loser if keep already has one.
  delete from contact_trainers
   where client_id = p_client and ghl_contact_id = p_drop
     and exists (select 1 from contact_trainers ct2 where ct2.client_id = p_client and ct2.ghl_contact_id = p_keep);
  update contact_trainers set ghl_contact_id = p_keep where client_id = p_client and ghl_contact_id = p_drop;

  -- Generic re-point: tables scoped by client_id + keyed by ghl_contact_id.
  foreach t in array ghl_client_tables loop
    execute format('update %I set ghl_contact_id = $1 where client_id = $2 and ghl_contact_id = $3', t)
      using p_keep, p_client, p_drop;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object(t, n); end if;
  end loop;

  -- Exceptions: trial_bookings is scoped by tenant_id; academy_memberships has no client scope.
  update trial_bookings set ghl_contact_id = p_keep where tenant_id = p_client and ghl_contact_id = p_drop;
  update academy_memberships set ghl_contact_id = p_keep where ghl_contact_id = p_drop;

  -- Re-point the portal contact_id (uuid) foreign keys.
  if keep_uuid is not null and drop_uuid is not null and keep_uuid <> drop_uuid then
    -- contact_field_values unique(contact_id, field_id): drop the losers first.
    delete from contact_field_values where contact_id = drop_uuid
      and field_id in (select field_id from contact_field_values where contact_id = keep_uuid);
    update contact_field_values set contact_id = keep_uuid where contact_id = drop_uuid;
    foreach t in array cid_client_tables loop
      execute format('update %I set contact_id = $1 where client_id = $2 and contact_id = $3', t)
        using keep_uuid, p_client, drop_uuid;
    end loop;
    update members       set contact_id = keep_uuid where client_id = p_client and contact_id = drop_uuid;
    update opportunities set contact_id = keep_uuid where client_id = p_client and contact_id = drop_uuid;
    update website_leads set contact_id = keep_uuid where client_id = p_client and contact_id = drop_uuid;
  end if;

  -- Consolidate identity: fill keep's blank fields from the duplicate.
  update contacts k set
    name         = coalesce(nullif(trim(coalesce(k.name,'')),''),         d.name),
    first_name   = coalesce(nullif(trim(coalesce(k.first_name,'')),''),   d.first_name),
    last_name    = coalesce(nullif(trim(coalesce(k.last_name,'')),''),    d.last_name),
    email        = coalesce(nullif(trim(coalesce(k.email,'')),''),        d.email),
    phone        = coalesce(nullif(trim(coalesce(k.phone,'')),''),        d.phone),
    athlete_name = coalesce(nullif(trim(coalesce(k.athlete_name,'')),''), d.athlete_name),
    updated_at   = now()
  from contacts d
  where k.client_id = p_client and k.ghl_contact_id = p_keep
    and d.client_id = p_client and d.ghl_contact_id = p_drop;

  -- Remove the duplicate contact record.
  delete from contacts where client_id = p_client and ghl_contact_id = p_drop;

  return jsonb_build_object('ok', true, 'keep', p_keep, 'drop', p_drop, 'moved', moved);
end
$$;

revoke execute on function merge_contacts(uuid, text, text) from anon, authenticated;

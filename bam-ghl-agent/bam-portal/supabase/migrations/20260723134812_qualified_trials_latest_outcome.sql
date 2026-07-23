-- Qualified-trial close rate: the LATEST outcome wins (Zoran, 2026-07-22).
--
-- BEFORE: `lost` was a bare EXISTS over pipeline_outcomes for status in
-- ('lost','nurture'). Sending a lead to Nurture writes such a row and the close
-- rate counts nurture as lost ("nurture = marked lost", Zoran 2026-07-15). But
-- when that lead REPLIES and gets bounced back to Responded, they are being
-- actively worked again - and the old EXISTS still scored them LOST forever
-- (unless they eventually bought). The rate read worse than reality.
--
-- AFTER: read the most recent outcome row per opportunity. The bounce paths now
-- append a 'reopened' row (api/agent/_reopen.js), so:
--     nurture                -> lost
--     nurture then reopened  -> pending  (back in play)
--     reopened then nurture  -> lost     (went quiet again)
-- `won` is unchanged and still beats everything (members table is ground truth,
-- "won beats lost if they buy later").
--
-- Pure function replacement - no schema change, no data rewritten, and rows keep
-- accumulating append-only so the full audit trail survives.

create or replace function public.cc_qualified_trials(p_client_id uuid, p_from timestamptz, p_to timestamptz)
returns table(ghl_contact_id text, name text, trainer text, trial_date timestamptz, outcome text, plan text)
language sql
stable
as $function$
  with reviews as (
    select r.opportunity_id, r.ghl_contact_id, r.trainer, r.created_at
    from post_trial_reviews r
    where r.client_id = p_client_id
      and r.showed_up is true
      and r.good_fit  is true
      and r.created_at >= p_from
      and r.created_at <  p_to
  ),
  bridged as (
    select rv.opportunity_id, rv.ghl_contact_id, rv.trainer, rv.created_at,
           o.ghl_opportunity_id, o.member_id,
           coalesce(o.athlete_name, o.contact_name) as opp_name
    from reviews rv
    left join opportunities o
      on o.client_id = p_client_id
     and (o.id::text = rv.opportunity_id or o.ghl_opportunity_id = rv.opportunity_id)
  ),
  scored as (
    select
      b.ghl_contact_id, b.trainer, b.created_at as trial_date, b.opp_name,
      (select m.athlete_name from members m
         where m.client_id = p_client_id and m.ghl_contact_id = b.ghl_contact_id
           and m.status in ('live','paused','payment_failed') limit 1) as member_name,
      (select m.plan from members m
         where m.client_id = p_client_id and m.ghl_contact_id = b.ghl_contact_id
           and m.status in ('live','paused','payment_failed') limit 1) as member_plan,
      (
        exists (select 1 from members m
                where m.client_id = p_client_id and m.ghl_contact_id = b.ghl_contact_id
                  and m.status in ('live','paused','payment_failed'))
        or b.member_id is not null
        or exists (select 1 from pipeline_outcomes po
                   where po.client_id = p_client_id and po.status = 'won'
                     and po.opportunity_id in (b.opportunity_id, b.ghl_opportunity_id))
      ) as won,
      -- LATEST outcome wins (was: exists-any). A later 'reopened' row un-marks lost.
      coalesce((
        select po.status
        from pipeline_outcomes po
        where po.client_id = p_client_id
          and po.opportunity_id in (b.opportunity_id, b.ghl_opportunity_id)
        order by po.created_at desc, po.id desc
        limit 1
      ) in ('lost','nurture'), false) as lost
    from bridged b
  )
  select
    ghl_contact_id,
    coalesce(nullif(member_name,''), nullif(opp_name,''), 'Athlete') as name,
    trainer,
    trial_date,
    case when won then 'won' when lost then 'lost' else 'pending' end as outcome,
    case when won then member_plan else null end as plan
  from scored;
$function$;

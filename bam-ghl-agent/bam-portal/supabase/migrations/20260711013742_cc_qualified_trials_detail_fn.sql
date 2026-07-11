-- Per-athlete detail behind the qualified trial close rate popup: every showed-up +
-- good-fit trial in the window with its outcome (won / lost / pending), the trainer,
-- and (for won) the plan. Drives the Won / Lost / Pending columns in the client
-- portal's "Qualified trial close rate" popup.
--
-- NOTE: applied live to prod on 2026-07-11 but never committed as a migration - see
-- the sibling 20260710224022_cc_qualified_close_rate_fn.sql note. Committed here so
-- a migration-built environment has both functions and cc-sales-kpis stops 500'ing.

CREATE OR REPLACE FUNCTION public.cc_qualified_trials(p_client_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(ghl_contact_id text, name text, trainer text, trial_date timestamp with time zone, outcome text, plan text)
 LANGUAGE sql
 STABLE
AS $function$
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
      exists (select 1 from pipeline_outcomes po
              where po.client_id = p_client_id and po.status = 'lost'
                and po.opportunity_id in (b.opportunity_id, b.ghl_opportunity_id)) as lost
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

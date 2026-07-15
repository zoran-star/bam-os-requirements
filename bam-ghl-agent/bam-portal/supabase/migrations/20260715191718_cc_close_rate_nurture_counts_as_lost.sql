-- Qualified trial close rate: count 'nurture' outcomes as LOST.
--
-- Why: when an academy has portal Lead-Nurture live, hand-marking a card "Lost"
-- is re-routed into the nurture sequence and the pipeline_outcomes row is written
-- with status 'nurture', not 'lost' (api/ghl/pipelines.js). The nurture stage IS
-- where lost-marked leads go (Zoran, 2026-07-15) - so every hand-marked loss was
-- invisible to the close rate and BAM GTA showed 100% (3 won / 0 lost) while 6
-- qualified trials sat in nurture. Fix: lost = pipeline_outcomes status in
-- ('lost','nurture'). Won still takes precedence (a nurtured lead who later buys
-- flips to won), and the nurture-exhausted path already writes a final 'lost'
-- row for the same opportunity, so the EXISTS check cannot double-count.

CREATE OR REPLACE FUNCTION public.cc_qualified_close_rate(p_client_id uuid, p_since timestamp with time zone)
 RETURNS TABLE(pool integer, won integer, lost integer)
 LANGUAGE sql
 STABLE
AS $function$
  with reviews as (
    select r.opportunity_id, r.ghl_contact_id
    from post_trial_reviews r
    where r.client_id = p_client_id
      and r.showed_up is true
      and r.good_fit  is true
      and r.created_at >= p_since
  ),
  bridged as (
    select rv.opportunity_id, rv.ghl_contact_id, o.ghl_opportunity_id, o.member_id
    from reviews rv
    left join opportunities o
      on o.client_id = p_client_id
     and (o.id::text = rv.opportunity_id or o.ghl_opportunity_id = rv.opportunity_id)
  ),
  scored as (
    select
      (
        exists (
          select 1 from members m
          where m.client_id = p_client_id
            and m.ghl_contact_id = b.ghl_contact_id
            and m.status in ('live','paused','payment_failed')
        )
        or b.member_id is not null
        or exists (
          select 1 from pipeline_outcomes po
          where po.client_id = p_client_id
            and po.status = 'won'
            and po.opportunity_id in (b.opportunity_id, b.ghl_opportunity_id)
        )
      ) as won,
      exists (
        select 1 from pipeline_outcomes po
        where po.client_id = p_client_id
          and po.status in ('lost','nurture')
          and po.opportunity_id in (b.opportunity_id, b.ghl_opportunity_id)
      ) as lost
    from bridged b
  )
  select
    count(*)::int                                as pool,
    count(*) filter (where won)::int             as won,
    count(*) filter (where lost and not won)::int as lost
  from scored;
$function$;

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
              where po.client_id = p_client_id and po.status in ('lost','nurture')
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

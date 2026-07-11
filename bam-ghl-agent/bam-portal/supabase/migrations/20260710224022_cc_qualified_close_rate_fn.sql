-- Qualified trial close rate for the command-center Sales KPI.
-- Pool = showed-up + good-fit post-trial reviews in the window; won = became a
-- live/paused/payment_failed member (or member_id set, or a 'won' pipeline_outcome);
-- lost = a 'lost' pipeline_outcome (and not won).
--
-- NOTE: this function was applied live to prod on 2026-07-10 but the migration file
-- was never committed - a fresh `supabase db reset` / branch / DR rebuild lacked it
-- and /api/ghl/cc-sales-kpis 500'd entirely (PostgREST 404 on the RPC). Committing
-- it here reconciles the repo with the linked project (same version number).

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
          and po.status = 'lost'
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

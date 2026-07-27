-- Academy public-facing FACTS + parent testimonials (sales-system portability).
--
-- Context: GTA's sales system is being made photocopyable. Everything a message
-- says about an academy has to come from that academy's OWN row at render time,
-- or drop out entirely. This migration adds the four identity facts the messages
-- still type by hand, plus the table that holds an academy's own parent quotes.
--
-- The governing rule for every column here is NO FACT, NO OUTPUT: a blank value
-- must make the block that uses it vanish, never render a placeholder, an empty
-- anchor, a dead link, or a dangling lead-in. The render side lives in
-- api/email-shells.js (resolveMergeVars / dropEmptyLinkMentions / dropEmptyShellLinks).
--
-- ALL ADDITIVE. Nothing is renamed, dropped, or rewritten.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) clients: the parent-facing identity facts
-- ─────────────────────────────────────────────────────────────────────────────

-- The name PARENTS see. `business_name` is the INTERNAL label ("BAM GTA") and it
-- is what {{location.name}} has been rendering, so parents have been reading our
-- internal shorthand in their own messages. This is the separate, public one
-- ("By Any Means Toronto"). Nullable on purpose: unset falls back to
-- business_name in clientVars, so every academy that never fills it keeps
-- working exactly as before.
alter table public.clients add column if not exists public_name text;
comment on column public.clients.public_name is
  'Parent-facing academy name. business_name stays the internal label. Readers must fall back to business_name when this is null.';

-- The academy's community group (WhatsApp for GTA, could be Facebook, Discord or
-- Telegram elsewhere). Two facts: the link, and the platform that names it in
-- copy ("Join the WhatsApp group"). Platform is a NORMALIZED KEY, never the
-- display label - the label is rendered from the key so copy stays in code.
-- The LINK is the fact that gates the line: no url means the whole line drops,
-- with or without a platform.
alter table public.clients add column if not exists community_group_url text;
alter table public.clients add column if not exists community_group_platform text;
comment on column public.clients.community_group_url is
  'Invite link to the academy''s parent community group. Empty = the whole "join the group" line drops.';
comment on column public.clients.community_group_platform is
  'Normalized platform key for community_group_url. Drives copy ("Join the WhatsApp group"); never stored as a display label.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_community_group_platform_check'
  ) then
    alter table public.clients
      add constraint clients_community_group_platform_check
      check (community_group_platform is null or community_group_platform in
        ('whatsapp', 'facebook', 'discord', 'telegram', 'other'));
  end if;
end $$;

-- Where a happy parent leaves a public review. No link on file means NO button
-- at all in the review-ask email - not a disabled one, not one pointing nowhere.
alter table public.clients add column if not exists google_review_url text;
comment on column public.clients.google_review_url is
  'Public Google review link. Empty = the review CTA is removed entirely, never rendered dead or disabled.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) update_client_basics: whitelist the four new columns
-- ─────────────────────────────────────────────────────────────────────────────
-- Same shape as 20260725033015 (the FULL current whitelist) with the four facts
-- appended. Each uses the `p_patch ? 'key'` form so an absent key leaves the
-- stored value alone and an explicit empty string CLEARS it to null - which is
-- what "no fact" has to mean for a field whose whole job is to drop when blank.
CREATE OR REPLACE FUNCTION public.update_client_basics(p_client_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_authorized boolean;
BEGIN
  SELECT (p_client_id IN (SELECT my_client_ids())) OR is_admin_staff() INTO v_authorized;
  IF NOT v_authorized THEN RETURN false; END IF;

  UPDATE clients SET
    business_name = COALESCE(NULLIF(p_patch->>'business_name', ''), business_name),
    owner_name    = COALESCE(NULLIF(p_patch->>'owner_name', ''),    owner_name),
    email         = COALESCE(NULLIF(p_patch->>'email', ''),         email),
    legal_name    = CASE WHEN p_patch ? 'legal_name'  THEN NULLIF(p_patch->>'legal_name','')  ELSE legal_name  END,
    address       = CASE WHEN p_patch ? 'address'     THEN NULLIF(p_patch->>'address','')     ELSE address     END,
    phone         = CASE WHEN p_patch ? 'phone'       THEN NULLIF(p_patch->>'phone','')       ELSE phone       END,
    entity_type   = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(p_patch->>'entity_type','') ELSE entity_type END,
    ein           = CASE WHEN p_patch ? 'ein'         THEN NULLIF(p_patch->>'ein','')         ELSE ein         END,
    time_zone     = CASE WHEN p_patch ? 'time_zone'   THEN NULLIF(p_patch->>'time_zone','')   ELSE time_zone   END,
    brand_data    = CASE WHEN p_patch ? 'brand_data'  THEN COALESCE(p_patch->'brand_data', brand_data) ELSE brand_data END,
    kpi_data      = CASE WHEN p_patch ? 'kpi_data'    THEN COALESCE(p_patch->'kpi_data', kpi_data)     ELSE kpi_data   END,
    onboarding_setup = CASE WHEN p_patch ? 'onboarding_setup' THEN COALESCE(p_patch->'onboarding_setup', onboarding_setup) ELSE onboarding_setup END,
    ads_content_approval_required = CASE WHEN p_patch ? 'ads_content_approval_required'
      THEN COALESCE((p_patch->>'ads_content_approval_required')::boolean, ads_content_approval_required)
      ELSE ads_content_approval_required END,
    tax_config    = CASE WHEN p_patch ? 'tax_config'  THEN NULLIF(p_patch->'tax_config', 'null'::jsonb) ELSE tax_config END,
    public_name   = CASE WHEN p_patch ? 'public_name' THEN NULLIF(p_patch->>'public_name','') ELSE public_name END,
    community_group_url = CASE WHEN p_patch ? 'community_group_url'
      THEN NULLIF(p_patch->>'community_group_url','') ELSE community_group_url END,
    community_group_platform = CASE WHEN p_patch ? 'community_group_platform'
      THEN NULLIF(p_patch->>'community_group_platform','') ELSE community_group_platform END,
    google_review_url = CASE WHEN p_patch ? 'google_review_url'
      THEN NULLIF(p_patch->>'google_review_url','') ELSE google_review_url END
  WHERE id = p_client_id;

  RETURN true;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) testimonials: an academy's OWN parent quotes
-- ─────────────────────────────────────────────────────────────────────────────
-- Feeds the testimonials emails today and the free-trial page cards later. One
-- row per quote, scoped to the academy that earned it.
--
-- EMPTY IS A VALID, CORRECT STATE. An academy with no rows renders no quote
-- block and no testimonials email at all. That is the point: the previous
-- failure was shipping one academy GTA's quotes with the names swapped and an
-- invented star rating. A new academy starts empty and stays empty until it has
-- its own.
--
-- NOT related to `onboarding_feedback.testimonial` - that column is the academy
-- OWNER reviewing BAM's onboarding. Opposite direction, different subject, do
-- not join them.
create table if not exists public.testimonials (
  id         uuid primary key default gen_random_uuid(),
  -- Tenant linkage. Every row belongs to exactly one academy.
  client_id  uuid not null references public.clients(id) on delete cascade,
  quote      text not null check (btrim(quote) <> ''),
  -- Display attribution only ("Marcus T."). Never an identifier, never a join key.
  author     text,
  -- Where the quote came from. 'manual' = typed in by the academy, 'google' =
  -- pulled from their Google reviews. This column decides who may write the row
  -- (see the RLS split and the guard trigger below).
  source     text not null default 'manual' check (source in ('manual', 'google')),
  -- Star rating, 1-5. NULL for a manual quote, and ENFORCED null: the guard
  -- trigger below refuses a rating (or a review date, or sync fields) on any
  -- manual row written by a non-staff caller. A typed quote never wears a star
  -- rating, never wears a "Google review" badge or date, and never moves the
  -- aggregate. Pinning `source` alone was not enough - it locked the label while
  -- leaving a fabricated 5.0 fully reachable under source='manual'.
  -- Curation depends on this column: starred first, then highest rating down,
  -- and anything below 4 never displays outside the owner's own card. The
  -- aggregate header ("4.9 average, 87 reviews") is computed from it too.
  rating     smallint check (rating is null or rating between 1 and 5),
  -- The quote the academy wants shown first (free-trial cards, one-quote emails).
  starred    boolean not null default false,
  -- Provider id for synced quotes (Google review id), so a re-sync updates the
  -- same row instead of duplicating it. Null for manual entries.
  external_id text,
  -- WHEN THE PARENT LEFT THE REVIEW, which is not when we wrote the row.
  -- `created_at` below is ours; on a first sync it would stamp every historical
  -- review as arriving today, and the free-trial cards display review dates.
  -- Null for manual quotes.
  review_created_at timestamptz,
  -- Last time the sync job confirmed this row against the provider. Lets a later
  -- pass reconcile edits and deletions on Google's side (a row whose synced_at
  -- is older than the current sweep no longer exists upstream).
  synced_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists testimonials_client_id_idx on public.testimonials (client_id);
-- The confirmed render order for the emails and the free-trial cards: starred
-- first, then highest rating down, then most recent review. Rating-first, NOT
-- newest-first - a 5-star from last year outranks a 4-star from last week.
-- `nulls last` keeps manual (unrated) quotes below rated ones rather than on top.
-- The below-4 cutoff is applied by the reader, not here: the owner's own card
-- must still show low ratings.
create index if not exists testimonials_client_order_idx
  on public.testimonials (client_id, starred desc, rating desc nulls last, review_created_at desc);
-- Idempotent provider sync: one row per (academy, source, provider id).
create unique index if not exists testimonials_client_source_external_idx
  on public.testimonials (client_id, source, external_id)
  where external_id is not null;

create or replace function public.touch_testimonials_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_testimonials_updated_at on public.testimonials;
create trigger trg_testimonials_updated_at
  before update on public.testimonials
  for each row execute function public.touch_testimonials_updated_at();

-- ── WRITE RULES, SPLIT BY SOURCE ────────────────────────────────────────────
-- Manual quotes are the academy's own words: they create, edit and delete them
-- freely, same as `offers` / `locations`.
--
-- Google rows are NOT theirs to write. A synced review is a record of what a
-- real parent actually said, so an academy must be able to star one and nothing
-- else. Letting them edit the text, invent a rating, or insert a fabricated row
-- stamped `source='google'` would hand them a supported path to manufacture
-- social proof - which is the exact failure this whole table exists to prevent.
-- Google rows are written by the sync job (service role) only.
--
-- Row-level scoping is expressed in the policies below; the column-level rule
-- ("only `starred` may change on a synced row") cannot be written as a policy,
-- because a policy sees either the old row or the new one, never both. That half
-- is enforced by the guard TRIGGER underneath, which is also what stops a manual
-- row being relabelled `source='google'` after the fact.
alter table public.testimonials enable row level security;

-- READ: the academy sees all of its own rows, including low-rated ones. The
-- below-4 display cutoff is a rendering rule, not a visibility rule - the owner
-- must be able to see a bad review on their own card.
drop policy if exists testimonials_client_read on public.testimonials;
create policy testimonials_client_read on public.testimonials
  for select to authenticated
  using ((client_id in (select public.my_client_ids())) or public.is_staff());

-- The academy-facing write policies are kept SEPARATE from the staff ones rather
-- than folded into one `is_staff() OR ...` expression. Postgres ORs permissive
-- policies together, so the behaviour is the same either way - but split, the
-- academy policy PINS `source = 'manual'` on its own line where it cannot be
-- misread. The trust boundary is the point: the application is exactly what we
-- do not trust here, so this must be impossible at the database, not merely
-- unusual through the UI.

-- INSERT (academy): `source` is PINNED to 'manual'. A client that posts
-- source='google' is rejected by the database no matter what it sends. There is
-- no path from an academy session to a google-sourced row.
drop policy if exists testimonials_client_insert on public.testimonials;
drop policy if exists testimonials_academy_insert on public.testimonials;
create policy testimonials_academy_insert on public.testimonials
  for insert to authenticated
  with check (
    (client_id in (select public.my_client_ids()))
    and source = 'manual'
  );

-- INSERT (staff): BAM staff can write either source, to seed or repair a sync.
drop policy if exists testimonials_staff_insert on public.testimonials;
create policy testimonials_staff_insert on public.testimonials
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE (academy): the row stays reachable whatever its source - a synced
-- review still has to be starrable - and the guard trigger below narrows a
-- google row to `starred` alone.
drop policy if exists testimonials_client_update on public.testimonials;
drop policy if exists testimonials_academy_update on public.testimonials;
create policy testimonials_academy_update on public.testimonials
  for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

drop policy if exists testimonials_staff_update on public.testimonials;
create policy testimonials_staff_update on public.testimonials
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE (academy): manual rows only, pinned the same way. An academy cannot
-- delete a real review it dislikes; reviews leave when they leave Google
-- (reconciled via synced_at).
drop policy if exists testimonials_client_delete on public.testimonials;
drop policy if exists testimonials_academy_delete on public.testimonials;
create policy testimonials_academy_delete on public.testimonials
  for delete to authenticated
  using (
    (client_id in (select public.my_client_ids()))
    and source = 'manual'
  );

drop policy if exists testimonials_staff_delete on public.testimonials;
create policy testimonials_staff_delete on public.testimonials
  for delete to authenticated
  using (public.is_staff());

-- The column-level half of the rule above. NOT `security definer` on purpose:
-- it must see the REAL caller in current_user to let the sync job through.
-- Fires before trg_testimonials_updated_at (triggers run in name order, g < u),
-- so it inspects the row as the caller submitted it.
--
-- ⚠️ NO `SECURITY DEFINER` FUNCTION MAY EVER WRITE `testimonials`. ⚠️
-- This guard trusts `current_user`. Inside a SECURITY DEFINER function owned by
-- postgres, `current_user` IS postgres, so the short-circuit below fires and the
-- caller sails past BOTH this trigger and RLS - an academy calling such an RPC
-- could write source='google', rating=5. That is not hypothetical: this repo
-- writes SECURITY DEFINER RPCs as a habit, and `update_client_basics` earlier in
-- THIS migration is one of them.
-- So: reach this table from an academy session through RLS only. If a helper RPC
-- ever becomes genuinely necessary, it must be SECURITY INVOKER, or it must
-- re-implement every rule here against the real caller's identity (passed in and
-- verified, never inferred from current_user).
create or replace function public.testimonials_guard_source()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- The Google sync job (service role) and migrations own synced content
  -- outright, and BAM staff need to be able to correct a bad sync.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if coalesce(public.is_staff(), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.source <> 'manual' then
      raise exception
        'testimonials: only manual testimonials can be created here - % rows come from the sync job', new.source
        using errcode = 'check_violation';
    end if;
    -- A TYPED QUOTE CARRIES NO REVIEW EVIDENCE. Pinning `source` alone only
    -- locked the label: an academy could still insert source='manual' with
    -- rating=5, a forged external_id and a made-up review date, and land in an
    -- aggregate as a fabricated 5.0. These four columns are the SUBSTANCE of a
    -- real review, so a non-staff caller may not set any of them, on any row.
    -- A typed quote never wears a star rating, never wears a "Google review"
    -- badge or a date, and never moves the average.
    if new.rating is not null
    or new.external_id is not null
    or new.review_created_at is not null
    or new.synced_at is not null then
      raise exception
        'testimonials: a typed testimonial cannot carry a rating, review date, or sync fields - those belong to real synced reviews'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.source = 'google' then
    -- Everything except `starred` (and `updated_at`, set by the touch trigger)
    -- must come back exactly as it went in.
    if new.quote             is distinct from old.quote
    or new.author            is distinct from old.author
    or new.rating            is distinct from old.rating
    or new.review_created_at is distinct from old.review_created_at
    or new.external_id       is distinct from old.external_id
    or new.synced_at         is distinct from old.synced_at
    or new.source            is distinct from old.source
    or new.client_id         is distinct from old.client_id
    or new.created_at        is distinct from old.created_at then
      raise exception
        'testimonials: a synced Google review is read-only - only starred can be changed'
        using errcode = 'check_violation';
    end if;
  else
    -- Updating a MANUAL row.
    if new.source is distinct from old.source then
      -- Closes the laundering route: write a quote as manual, flip it to google.
      raise exception
        'testimonials: a manual testimonial cannot be relabelled as a Google review'
        using errcode = 'check_violation';
    end if;
    -- Same rule as the INSERT branch, via the back door: a non-staff caller may
    -- not ADD review evidence to a typed quote after the fact either. Compared
    -- against OLD rather than required to be null, so a staff-seeded value
    -- survives an academy editing the quote text around it.
    if new.rating            is distinct from old.rating
    or new.external_id       is distinct from old.external_id
    or new.review_created_at is distinct from old.review_created_at
    or new.synced_at         is distinct from old.synced_at then
      raise exception
        'testimonials: a typed testimonial cannot gain a rating, review date, or sync fields'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_testimonials_guard_source on public.testimonials;
create trigger trg_testimonials_guard_source
  before insert or update on public.testimonials
  for each row execute function public.testimonials_guard_source();

-- ── TWO DIFFERENT EMPTY STATES. DO NOT COLLAPSE THEM. ───────────────────────
-- Both of these mean "do not send the testimonials email", but they are not the
-- same situation and the onboarding step's completion detector has to tell them
-- apart:
--
--   no rows at all          -> WE NEVER ASKED. The academy still owes us quotes,
--                              and the onboarding step is incomplete.
--   rows, none starred      -> THEY ANSWERED. They gave us quotes and chose not
--                              to feature any. The step is done.
--
-- So do not add a view, helper, or RPC that returns the same empty result for
-- both, and do not have a reader treat "no starred rows" as "no testimonials".
-- The distinguishing query is a plain count over the academy's rows, which
-- testimonials_client_id_idx already serves:
--   select count(*), count(*) filter (where starred) from testimonials
--    where client_id = $1;
--
-- `starred` is readable per academy through testimonials_client_read (the SELECT
-- policy returns every column of the academy's own rows, whatever the source),
-- which is what lets a reader decide which quotes render.

-- NO SEED DATA. Deliberately. Not for GTA, and above all not for San Jose or any
-- other academy: a preset that arrives carrying someone else's parent quotes is
-- the exact failure this table exists to prevent.

-- The academy's public Google rating, as a CHECKABLE fact.
--
-- ✅ APPLIED to prod 2026-07-29 via mcp apply_migration (name: client_google_rating),
-- orchestrator gate cleared, align-core-data-model waived by Zoran's blanket
-- instruction for this workstream. Columns + all three constraints verified in
-- production by query afterwards, not by the success flag.
--
-- Context: Zoran's ruling 2026-07-29, "quotes stay plain, the rating is real."
--
-- A hand-copied review is real but nothing verified it and nothing can
-- reconcile it later, so a typed quote never wears a star rating, a "Google
-- review" badge or a date - `testimonials_guard_source` already enforces that
-- at the row level. The AGGREGATE is different in kind: it is one number,
-- published by Google, and anyone can check it in five seconds. So it may
-- display while the quotes stay plain.
--
-- HOW THESE ARE POPULATED, and why the naming matters:
--
-- The testimonials skill READS them off the owner's Business Profile via
-- Claude in Chrome. So they are not hand-typed, but they are also NOT synced -
-- they are a POINT-IN-TIME READING that goes stale silently the moment the
-- academy's next review lands.
--
-- ⚠️ Label these in any UI as "what their Google profile showed on <date>",
-- never as a live or verified figure. The precedent is `clients.email`, which
-- the card labelled "Owner email" while publishing it to parents as the public
-- contact address: a field whose label disagreed with its use, filled
-- inconsistently by academies who were each right by their own reading. A
-- rating that reads as fetched-and-current when it was read once weeks ago is
-- the same error in a new place.
--
-- Interim with a deliberate shelf life: once Google Business Profile sync
-- lands, the aggregate is computed from synced `testimonials` rows and these
-- become a fallback for academies that never connected. Nothing should be
-- built that assumes they are the permanent source.
--
-- ALL ADDITIVE. Nothing is renamed, dropped, or rewritten.

alter table public.clients add column if not exists google_rating numeric(2,1);
alter table public.clients add column if not exists google_review_count integer;
alter table public.clients add column if not exists google_rating_checked_at timestamptz;

comment on column public.clients.google_rating is
  'Google star rating as READ from the owner''s Business Profile at google_rating_checked_at. A point-in-time reading, NOT a synced or verified figure. Empty = no rating renders anywhere. Label it in UI as what their profile showed on that date, never as current.';
comment on column public.clients.google_review_count is
  'Number of public Google reviews behind google_rating, read at the same moment. Meaningless without it: see the both-or-neither constraint.';
comment on column public.clients.google_rating_checked_at is
  'When these two figures were last read off Google. NOT decoration: it is what makes staleness visible instead of silent. A rating without it is a number nobody can date, and readers should treat an old reading as old.';

-- Range guards. A rating outside 1.0-5.0 or a negative count is a typo, and a
-- typo in a number we publish to parents is the same class of problem as an
-- invented quote.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_google_rating_range_check') then
    alter table public.clients
      add constraint clients_google_rating_range_check
      check (google_rating is null or (google_rating >= 1.0 and google_rating <= 5.0));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clients_google_review_count_check') then
    alter table public.clients
      add constraint clients_google_review_count_check
      check (google_review_count is null or google_review_count >= 0);
  end if;

  -- BOTH OR NEITHER. "4.9 stars" with no count, or "67 reviews" with no rating,
  -- is half a fact, and half a fact rendered next to a parent's decision reads
  -- as a whole one. The no-fact-no-output rule needs a single unambiguous
  -- answer to "is there a rating to show", so the database refuses the state
  -- where that question has two answers.
  if not exists (select 1 from pg_constraint where conname = 'clients_google_rating_pair_check') then
    alter table public.clients
      add constraint clients_google_rating_pair_check
      check (
        (google_rating is null and google_review_count is null)
        or (google_rating is not null and google_review_count is not null)
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DELIBERATELY NOT IN THIS MIGRATION
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) `update_client_basics` is NOT extended to whitelist these columns. That
--    function and `client-portal.html` are currently being edited by three
--    other workstreams (the Business Basics hydration fix, the templating
--    foundation, and item 1c), with a documented merge order. Adding a fourth
--    editor to the same function invites exactly the silent-overwrite class of
--    bug that `_bbGuardBlanks` exists to catch. Portal wiring lands as its own
--    coordinated step, after those settle.
--
-- 2) No reader, no aggregate helper, no render change. Columns first, readers
--    once the store and the resolver exist. A reader shipped ahead of its data
--    is the "inert until configured" argument, and the 2026-07-25 enroll
--    incident is why that argument is no longer accepted here.

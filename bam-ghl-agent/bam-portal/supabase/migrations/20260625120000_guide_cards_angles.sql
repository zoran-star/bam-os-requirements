-- Multi-format guide cards (Phase 1).
-- A guide card (per offer) gains `angles[]`: each angle is a recommended creative
-- idea with a shared purpose and up to two executions (video / graphic), each
-- with its own labeled script `segments`, tips, and example_assets.
-- Legacy columns (purpose/filming_tips/example_script/example_assets) are KEPT
-- as a safety net + backward-compat for the current client wizard render.
-- `is_default` flags the card the "First Campaign" starter view renders.
-- Idempotent.

alter table public.guide_cards
  add column if not exists angles jsonb not null default '[]'::jsonb;

alter table public.guide_cards
  add column if not exists is_default boolean not null default false;

-- Backfill: wrap any card that already has authored content into angles[0]
-- (single execution; medium defaults to video since legacy content wasn't split).
-- Only touches cards that have real content AND no angles yet.
update public.guide_cards
set angles = jsonb_build_array(
  jsonb_build_object(
    'name', 'Recommended',
    'purpose', coalesce(purpose, ''),
    'video', jsonb_build_object(
      'segments', jsonb_build_array(
        jsonb_build_object('label', 'Script', 'text', coalesce(example_script, ''))
      ),
      'tips', coalesce(filming_tips, ''),
      'example_assets', coalesce(example_assets, '[]'::jsonb)
    ),
    'graphic', null
  )
)
where angles = '[]'::jsonb
  and (
    coalesce(purpose, '') <> ''
    or coalesce(example_script, '') <> ''
    or coalesce(filming_tips, '') <> ''
    or coalesce(example_assets, '[]'::jsonb) <> '[]'::jsonb
  );

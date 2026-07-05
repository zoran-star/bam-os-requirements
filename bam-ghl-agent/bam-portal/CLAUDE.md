# bam-portal Agent Notes

## ⛔ Front-end work: load the design system first

Before ANY UI/front-end change in this folder (client portal, new pages, components), read [`design-system/DESIGN.md`](design-system/DESIGN.md) and use the tokens in [`design-system/tokens.css`](design-system/tokens.css). Never hardcode colors/radii/fonts/shadows a token covers. If a token changes, mirror it in `public/client-portal.html`'s `:root` in the same commit (and vice versa). The V2 Home / Assets / Calendar views are the reference implementations.

## Supabase

Before touching Supabase migrations, seeds, local replay, storage buckets, or linked project repair, read [`supabase/README.md`](supabase/README.md).

That README explains the current temporary migration state:

- historical backfill migrations exist only to make fresh local replay work
- those backfills must be marked applied on the linked project before any linked push
- `supabase migration fetch --linked` can overwrite local replay fixes
- seed files provide local BAM GTA fixture rows after migrations finish
- storage bucket coverage is incomplete and may need a later idempotent backfill

Do not duplicate those details here. Keep [`supabase/README.md`](supabase/README.md) as the source of truth.

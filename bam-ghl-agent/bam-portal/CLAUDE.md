# bam-portal Agent Notes

## ⛔ Academy-owner onboarding = the `_obf*` paged wizard here, ONE place

All owner onboarding changes live in `public/client-portal.html` (`_obf*`). A step
renders ONLY if its `key` is in BOTH `_OBF_STEPS` (definition + detector + CTA) AND
a section's `keys` in `_OBF_SECTIONS` (Academy · Brand · Wired · Offer · Launch).
Adding to `_OBF_STEPS` alone = invisible in the wizard. The old checklist renderer
is gone; do not build onboarding anywhere else. Full rule + do-not-touch list in
[`../CLAUDE.md`](../CLAUDE.md).

## ⛔ Before pushing staff-portal (src/) changes: build AND lint

`npx vite build` alone does NOT catch undefined variables - a leftover
reference to a deleted identifier builds green and then blanks the page in
production (this happened 2026-07-27: a removed `banner` state with one
missed render site blanked ?p=content). Always also run:

```bash
npx eslint src/ -f json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const n=JSON.parse(d).flatMap(f=>f.messages).filter(m=>m.ruleId==='no-undef');n.forEach(m=>console.log(m.message));process.exit(n.length?1:0)})"
```

Zero `no-undef` results required before any push.

## ⛔ Front-end work: load the design system first

Before ANY UI/front-end change in this folder (client portal, new pages, components), read [`design-system/DESIGN.md`](design-system/DESIGN.md) and use the tokens in [`design-system/tokens.css`](design-system/tokens.css). Never hardcode colors/radii/fonts/shadows a token covers. If a token changes, mirror it in `public/client-portal.html`'s `:root` in the same commit (and vice versa). The V2 Home / Assets / Calendar views are the reference implementations.

## Supabase

**🗄️ At the START of any session working in this folder from Zoran's machine (Supabase CLI available): check [`supabase/PENDING_SQL.md`](supabase/PENDING_SQL.md). If the PENDING table has rows, tell Zoran immediately and offer to run `/pending-sql`.** Remote/cloud sessions skip this check (they can't apply anyway).

**⛔ If you add a migration file you cannot apply to prod yourself (remote/cloud sessions never can): add a row to [`supabase/PENDING_SQL.md`](supabase/PENDING_SQL.md) in the SAME commit.** That ledger is how the SQL reaches Zoran - `/showtime` and `/start` surface it, and `/pending-sql` applies it via the Supabase CLI. Write your code so it degrades gracefully until the migration lands (feature off / fallback query), never in a way that 500s pre-migration.

Before touching Supabase migrations, seeds, local replay, storage buckets, or linked project repair, read [`supabase/README.md`](supabase/README.md).

That README explains the current temporary migration state:

- historical backfill migrations exist only to make fresh local replay work
- those backfills must be marked applied on the linked project before any linked push
- `supabase migration fetch --linked` can overwrite local replay fixes
- seed files provide local BAM GTA fixture rows after migrations finish
- storage bucket coverage is incomplete and may need a later idempotent backfill

Do not duplicate those details here. Keep [`supabase/README.md`](supabase/README.md) as the source of truth.

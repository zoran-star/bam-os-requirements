# BUILD BRIEF - V2 client-portal HOME redesign

You are building the **V2 Home view** of the client portal in the FullControl command-center design language. Zoran is redesigning the **Marketing** page in a parallel session in the SAME file - yours is the sibling. Isolation discipline matters (below).

## Working setup (local-first, ship once)
1. Work in a git worktree, never the main checkout:
   `cd ~/bam-os-requirements && scripts/wt coleman-home && cd ~/bam-os-worktrees/coleman-home`
2. Iterate on a LOCAL dev server (do NOT push per tweak - Vercel deploys take 10+ min):
   `cd bam-ghl-agent/bam-portal && npm install && npm run dev -- --host --port 5175`
   -> http://localhost:5175/client-portal.html (ports 5173/5174 taken by other sessions). The vite proxy sends /api/* to PROD, so log in as BAM GTA for live data.
3. Ship ONCE at the end: branch -> PR -> CI green -> merge (main auto-deploys).

## Conflict avoidance (Zoran owns Marketing)
- Prefix ALL your CSS classes with `hm-` and JS helpers with `_hm`.
- Do NOT touch: `mm-*` classes, `_mm*` functions, or the Marketing view (`#view-marketing`).

## Where the code is (anchors are the reliable guide - grep the names, line #s approximate)
- File: `bam-ghl-agent/bam-portal/public/client-portal.html` (~37k lines).
- Home markup: `#view-home` (~6029-6103). Shared profile row (greeting `#home-greeting`, status `#home-status-text`) ~6038-6048, then the `#home-v2` container ~6054 (empty; filled by JS).
- Render entry: `openHomeView()` ~12159. For V2 it shows `#home-v2`, hides the generic sections, calls `renderHomeV2()`, returns. LEAVE the V1 and V1.5 branches untouched.
- Current V2 render: `renderHomeV2()` ~12264, `_hv2Style()` ~12223, `_hv2Tile()` ~12242, `_hv2Set()` ~12252, `_hv2Load()` ~12276. The 4 tiles' data (trials today, done-trial replies, hawkeye actions, unread) loads in `_hv2Load` - REUSE this data layer, don't rebuild it.

## Hard constraints
1. PRESERVE content + order: profile -> "Today at a glance" 4 tiles (Trials today · Done-trial replies · Hawkeye actions · Unread messages). Restyle them; do not reorder or remove. Anything you ADD (status, action items, KPIs) goes BELOW.
2. V2 ONLY. Gate with `typeof V2_ACCESS !== 'undefined' && V2_ACCESS`; quiet no-op otherwise. V1 + V1.5 must stay pixel-identical to today.
3. Fail quiet: if a data fetch errors, hide that section - never show a client an error.
4. Compose from data that already exists: the 4 tiles (`_hv2Load`), `action_items` (Supabase `_sb.from('action_items')`), KPIs (`/api/kpis-v15`), tickets. Flag anything you need that doesn't exist - do not invent endpoints.
5. NEVER use an em dash. Hyphen only. (Repo-wide hard rule.)

## Section plan (top to bottom)
1. `hm-` Command header - greeting + date (Jakarta; context, not a verdict).
2. `hm-` Today - the existing 4 tiles, restyled as one-read cards. [PRESERVED content + order]
3. `hm-` Status - one-read verdict: "On course" (calm, breathing dot) or "X needs you" (derived from hawkeye + unread + done-reply counts). Silence = good.
4. `hm-` Action items - from `action_items`: verdict "All clear" / "N to do"; list on drill.
5. `hm-` Monthly progress (fast-follow) - from `/api/kpis-v15`: progress toward targets; server-owned health bands.

## Design tokens (use the portal's OWN CSS vars - light theme, already default; fonts already loaded in <head>)
- Words = Plus Jakarta Sans. DM Mono ONLY for numeric stat values - never labels or sentences. No wide-tracked uppercase "typewriter" anywhere.
- Section labels: Jakarta 14px/700, UPPERCASE, letter-spacing 0.05em, color `var(--text-sub)`, with a 15px SVG icon beside it (stroke-width 1.5, match the guide-card icon style).
- Sub/meta text: Jakarta 12px/500, sentence case, `var(--text-mute)`.
- Cards: 16px radius; shadow `0 4px 14px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)`; `1px solid var(--line)` border; background `var(--surface-el)`.
- Portal color vars (light): `--surface` #FFF, `--surface-el`, `--border`, `--line`, `--text` #1C1B18, `--text-sub` #5F5A50, `--text-mute` #8E867A, `--gold` #C8A84E.
- Status fills: green #3EAF5C / amber #E09D24 / red #E05A42. Status TEXT uses the darker variants #2D8A52 / #B08E30 / #B5352F.
- Color = verdict ONLY. Neutral text everywhere else. "Down is good" (e.g. cheaper CAC) must be said in WORDS, never by color alone.

## UX principles (Zoran iterated hard - follow these)
1. ONE-READ RULE: the top of each card answers its question. Verdict first, evidence below, detail in a drawer.
2. Hierarchy by SIZE not labels: the answer is the biggest text; quiet eyebrows. Squint test.
3. Color = verdict only.
4. Silence = good: notes/warnings render ONLY when something needs attention. A healthy card is quiet (breathing dot, no text).
5. Strict left rail: one column, no floating right-side fragments; the eye falls straight down.
6. Say everything once (no repeating a detail that lives in a row below).
7. Space over ink: 20px section rhythm; cut words before shrinking.
8. Motion = meaning: breathing dot (2.2s opacity pulse) = healthy; staggered fade-in ~200ms steps top-to-bottom on load; skeleton loaders shaped like the final layout (no spinners); one-time glint only when significant; EVERY animation needs a prefers-reduced-motion fallback.
9. Big tap targets: "go deeper" = one large glowing gold panel (soft gold wash, breathing border, sheen sweep ~8s), ONE-word label; detail opens as "Focus mode" - a full-height drawer gliding in from the right (0.65s) over a radial vignette (darkened edges).
10. All judgments (health bands, verdicts) come from the SERVER; the client draws what it's told.

## North star (read verbatim, never approximate)
- `prototype/src/pages/Home.jsx` + `prototype/src/styles/Home.module.css` - the command-center feel.
- `prototype/src/styles/Marketing.module.css` - copy the label/status/card treatments; Zoran's Marketing card uses these, yours must match as a sibling.
- `prototype/src/styles/theme.css` - token intent.

## Pre-ship checks (all must pass before the PR)
- `node --check` on any inline `<script>` block you touched (extract the block, check it).
- `node bam-portal/scripts/verify-client-portal-ui.mjs` (tour targets - the redesign should not touch them, but confirm).
- `npm run build`.

## First move
Read `Marketing.module.css` + `Home.module.css` for exact treatments, then build **section 2 first** (restyle the 4 tiles) so Coleman can preview the look on localhost, then add sections 3, 4, 5. Iterate on the dev server; ship once at the end.

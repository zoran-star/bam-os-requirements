# Golden renders

`bam-gta/` is the committed record of every automated email **BAM GTA** sends.
BAM GTA is a live academy with real paying members, so its messages must not change
because something behind them was refactored. `api/_gta-message-lock.test.mjs` renders
all of them through the real send path and fails if anything moved.

```
node api/_gta-message-lock.test.mjs
```

## The two locks

| Folder | What it holds | What a failure means |
|---|---|---|
| `bam-gta/words/*.txt` | Parent-visible text, tags stripped, plus every link target in order | **A parent receives different words, or a button goes somewhere else.** |
| `bam-gta/markup/*.html` | The full rendered HTML, byte for byte | Colours / padding / structure / `<title>` moved. A parent may notice nothing. |

A failure prints the words diff first, then any markup-only differences, so you can
tell at a glance which kind you are looking at.

## Where these came from

The **words** goldens were generated from `origin/main` at `477a604` - GTA's output as
it was in production on 27 Jul 2026, before the automation-templating wave. They are
the production truth and only move on a deliberate, owner-approved copy change.

Owner-approved changes so far, all on 27 Jul 2026:

1. The footer reason on `onboarding-story`, `-era` and `-testimonials` went from
   "you enquired about" to "you joined". Those three go to people who have already
   paid, so the lead-nurture sentence was untrue of them. Three words goldens and the
   same three markup goldens moved by one line each; the four `nurture-*` goldens are
   byte-identical, because "enquired" is still correct for a lead.
2. `onboarding-welcome` got its "online programs" and "bring a friend" items back,
   now gated on a per-academy fact rather than deleted.
3. `{{location.name}}` started rendering the academy's PARENT-FACING name. GTA's
   `public_name` is "By Any Means Basketball"; "BAM GTA" is our internal label and
   was leaking into customer copy. `nurture-1` and `onboarding-story` moved by three
   lines each - the only two templates that use the token. `nurture-2/3/4` and the
   other six are byte-identical, which is the proof nothing else came with it.

## The fixture, and why it is not written down twice

The lock renders from **`scripts/snapshots/bam-gta.json`** (repo root), the committed
copy of GTA's `clients` row that `scripts/render-messages.mjs` already uses. One file
answers "what does GTA's row look like today".

It used to be a hardcoded literal inside the test as well, and change 3 above is what
that cost: the `public_name` column was added, production's value changed, the literal
did not, and `clientVars()`'s `public_name || business_name` fallback quietly resolved
to the old name. All ten goldens passed - against a reality that no longer existed.
Goldens only prove today's render equals yesterday's; if the fixture drops a field,
both sides of that comparison move together and the diff is empty.

So `fixtureProblems()` in the test asserts the fixture against production's shape
rather than against itself: the snapshot carries a `public_name`, `clientVars()`
actually resolves to it, some rendered message actually contains it, and the internal
`business_name` label appears in none of them. Those checks run under `--bless-*` too,
because re-blessing is the one moment a stale fixture gets baked in permanently.
**When a column that reaches parents is added, update the snapshot and add it there.**

The **markup** goldens were re-blessed once on 27 Jul 2026, for the shell move
(`e677243`: onboarding-welcome / -training / -review stopped carrying their own copy of
the header and footer and now ride the shared shell in
`api/email-templates/_shell.js`). That change moved comments, whitespace, a few grey
shades and some padding, and nothing a parent reads. The words lock was enforced
across that bless, which is how we know.

## Re-blessing

Only when a change to GTA **is** intended. Both commands rewrite files you must then
commit - the git diff is the record of what changed.

**Markup only** (a refactor, a shell move, restyling):

```
node api/_gta-message-lock.test.mjs --bless-markup
```

The words lock still runs immediately afterwards, so this can never quietly change copy.

**Words** (GTA's parents will read something different):

```
node api/_gta-message-lock.test.mjs --bless-words I-AM-CHANGING-WHAT-GTA-PARENTS-READ
```

The phrase is required. Put the reason and who decided it in the commit message.

## Small expected differences

A difference that is expected but narrow does **not** get a re-bless. It gets an entry
in `WORD_WAIVERS` in the test, naming the decision and its date, so everything else in
that same email stays locked. A waiver that no longer matches the golden fails the run,
so they cannot rot into a blanket exemption.

Current waivers: **none.** The six that once excused `onboarding-welcome` dropping its
"online programs" and "bring a friend / merch" items are gone - those items are back
(change 2 above), so there is no difference left for a waiver to describe.

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

Owner-approved changes so far. Changes 1-3 are 27 Jul 2026:

1. The footer reason on `onboarding-story`, `-era` and `-testimonials` went from
   "you enquired about" to "you joined". Those three go to people who have already
   paid, so the lead-nurture sentence was untrue of them. Three words goldens and the
   same three markup goldens moved by one line each; the four `nurture-*` goldens are
   byte-identical, because "enquired" is still correct for a lead.
2. `onboarding-welcome` got its "online programs" and "bring a friend" items back,
   now gated on a per-academy fact rather than deleted.
3. `{{location.name}}` started rendering the academy's PARENT-FACING name. GTA's
   `public_name` was "By Any Means Basketball" (see change 4); "BAM GTA" is our
   internal label and was leaking into customer copy. `nurture-1` and
   `onboarding-story` moved by three lines each - the only two templates that use the
   token. `nurture-2/3/4` and the other six are byte-identical, which is the proof
   nothing else came with it.

### 4. The email layer's last academy-specific hardcode, 29 Jul 2026

`api/email-shells.js` carried a `LOCATIONS` map keyed by client id with exactly one
entry, BAM GTA's, pinning its email identity over whatever its `clients` row said. It
is **deleted**, so every academy now renders from its own row. The data half is
migration `20260729T235000` (GTA's `public_name`, GTA's `address`, San Jose's
`public_name`); it is **not applied yet** - see `supabase/PENDING_SQL.md`.

Approved by Zoran including the visible cost. **All 37 step + words goldens and the 10
markup goldens were re-taken**, and every one of the 133 changed lines is one of these
three changes and nothing else (verified line by line, not re-captured on faith):

| What a parent sees | Before | After | Golden files |
|---|---|---|---|
| the gold wordmark word | `BY ANY MEANS GTA` | `BY ANY MEANS TORONTO` | 33 |
| the small line beside it | `OAKVILLE · GTA` | `OAKVILLE` | 27 |
| the academy's name in copy, the `<title>` and the footer reason | `By Any Means Basketball` | `By Any Means Toronto` | 16 |

**Why the wordmark had to move.** The wordmark word and the full name BOTH derive from
`public_name` (the word is the name with the "By Any Means" prefix stripped). Keeping
both of the old strings - a `GTA` wordmark AND a "By Any Means Toronto" full name -
would have needed a pinned suffix column, which is the hardcode again wearing a
database column. One field drives everything; no overrides.

**A fourth change that is deliberately invisible.** GTA's `address` gained its city
(`2205 Rosemount Cres` -> `2205 Rosemount Cres, Oakville, ON`). `cityFromAddress()`
returns `""` for a bare street line, and the pin used to cover for that. Without the
address fix, **8 of the 10 templates would have lost their location tag** and 4 would
have lost the city from their body copy ("In a lot of Oakville programs" -> "In a lot
of programs"). Measured, not reasoned about. With it, `{{location.city}}` and the tag
render exactly what the pin used to supply, so those lines do not appear above.

### 5. The academy's name stopped being typed anywhere, 30 Jul 2026

The two remaining places the name was typed instead of resolved, both approved by Zoran.
**9 golden files moved, one line each, and nothing else** (read line by line, not
re-captured on faith):

| # | What a parent sees | Before | After | Golden files |
|---|---|---|---|---|
| a | the identity kicker above "A global basketball ecosystem" | `By Any Means Basketball · Est. 2015` | `By Any Means Toronto` | 6 |
| b | the welcome SMS's first line | `welcome to By Any Means Basketball!` | `welcome to By Any Means Toronto!` | 1 |
| c | the welcome email's SUBJECT | `Welcome to By Any Means Basketball 🏀` | `Welcome to By Any Means Toronto 🏀` | 1 |
| d | the summer promo SMS's first line | `It's coach from By Any Means Basketball - we're just` | `It's coach from By Any Means Toronto - we're just` | 1 |

**(a) came from a SHARED template, so it was never GTA's alone.** The kicker was typed
into `nurture-1` in `api/email-templates/nurture-emails.js`, which every academy renders
from, so every academy's nurture-1 carried BAM's name (confirmed by rendering San Jose's:
its kicker said "By Any Means Basketball" under a wordmark reading SAN JOSE). It is now
`{{ACADEMY_FULL}}`. **It moved SIX golden files, not two, because `onboarding-story` IS
`nurture-1`** (`forMembers("nurture-1")` in `onboarding-emails.js`), so one line reaches
two of GTA's emails. The step lock caught the second one; it was not predicted.

`api/_shared-template-names.test.mjs` is the new guard: it renders all ten shared
templates for two unrelated academies and fails on any line that is identical for both
yet names an academy. `MUTATE=hardcode` restores this exact bug and must be caught.

**"Est. 2015" was DROPPED from that line, and that is a deliberate content decision, not
a rename.** No `clients` column holds a founding year and inventing one for a single line
was rejected. Dropping it costs nothing here because **the same email states the year
twice more and both survive**: the `EST. 2015` badge beside the gold wordmark two lines
above it, and "Founded by Coleman Ayers in 2015" in the body. So this does NOT make
`nurture-1` academy-neutral and must not be read that way - see the "WHAT IT DOES NOT
PROVE" section of the new suite.

**(b), (c) and (d) are database rows, not code**, and need migration `20260730T120000`
(`supabase/PENDING_SQL.md`) to be applied. The snapshot below carries the tokenized
values ahead of production so these goldens lock what GTA will send, exactly as change 4
did. Section 9 of `api/_email-identity-from-the-row.test.mjs` used to assert these three
rows still hand-typed the name; it now asserts they follow the row, which is the claim
that matters - renaming the academy moves all three messages.

**Deliberately NOT changed:** onboarding step 5's subject, "Where By Any Means came
from". That names the brand family the origin story is about, not the academy;
"Where By Any Means Toronto came from" would be false. Pinned in section 9.

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

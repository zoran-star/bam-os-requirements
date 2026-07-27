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

One such change so far: on 27 Jul 2026 the footer reason on `onboarding-story`,
`-era` and `-testimonials` went from "you enquired about" to "you joined". Those three
go to people who have already paid, so the lead-nurture sentence was untrue of them.
Three words goldens and the same three markup goldens moved by one line each; the four
`nurture-*` goldens are byte-identical, because "enquired" is still correct for a lead.

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

Current waivers: `onboarding-welcome` dropped its "online programs" and
"bring a friend / merch" items, and renumbered the list, by the owner's decision on
27 Jul 2026.

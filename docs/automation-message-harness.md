# Automation message render harness

`scripts/sj-message-preview.mjs` + `.sh` + `.data.json`

Renders every automation step for an academy **exactly as a parent receives it**, then
serves it as a static review page on `:4600`.

```bash
bash scripts/sj-message-preview.sh
```

## What makes it trustworthy

It imports the REAL production send path rather than approximating it:

| Piece | Source |
|---|---|
| `renderEmail`, `resolveMergeVars`, `locFor`, `clientVars` | `bam-ghl-agent/bam-portal/api/email-shells.js` |
| The 4 designed nurture emails | `api/email-templates/nurture-emails.js` |
| How `vars` are assembled | mirrors `api/automations.js` (`{ first_name, full_name, athlete, next_session, ...clientVars(client) }`) |

SMS renders through `resolveMergeVars` the same way `api/_send.js` does. Emails render
through `renderEmail`, so `template:<key>` refs resolve, the branded shell fills with the
academy's own identity, and empty-token link dropping behaves as it does in a real send.

Designed emails show as real HTML in auto-sized iframes; SMS as phone bubbles with
character and segment counts. Grouped by sequence, with the wait before each message.

Read-only. It cannot enable, approve, or send anything.

## Why rendered output beats grep here

During the 2026-07-26 preset-parity audit, a static literal-grep produced **three
BLOCKER-severity false positives**:

1. "`locFor` falls back to GTA identity for unmapped academies" - that fallback was
   removed 2026-07-25. The grep hit the *comment documenting its removal*.
2. "Agent default sections claim to be BAM GTA (1079 Linbrook, Oakville)" - true in the
   file, but `fact-render.js` overrides those keys at runtime from the academy's own data.
3. "Nurture templates hardcode Toronto" - they are fully tokenized; PR #1601 fixed them.

All three died against rendered output. The same pass found **two real leaks the grep
missed**: `social_proof` has no fact-renderer at all, and the override layer fails OPEN
(`if (!data) return {}`) so an academy with no training offer inherits every GTA default.

**The rule:**

> A GTA literal sitting in a source file is NOT evidence of a live leak. What separates a
> live leak from a dead one is: does anything override this value on the path to output,
> and does that override fail OPEN or CLOSED?

This codebase deliberately carries comments naming old bad values so nobody reintroduces
them. Any drift checker that string-matches will re-raise every already-fixed bug forever
and train everyone to ignore it. Check code paths, not strings.

## Limitation

Pinned to one academy: a `CLIENT_ID` const plus a committed data snapshot in
`.data.json` rather than a live read. Parameterising by client id and reading
`automation_steps` live turns this into a before/after verification surface for any
academy a preset change touches.

## ⚠️ Two things that must survive

**1. `nurture-3` and `onboarding-testimonials` must NOT be promoted with the other
onboarding emails.** Both quote real BAM GTA parents, re-attributed to whatever academy
sends them via `{{location.city}}` ("Parent of Adam, {{location.city}}"). Zoran's ruling
(2026-07-27) is a **quote-free variant**: the drip still sends on schedule and the quote
block drops out until that academy has Google reviews connected. Until that variant
exists, these stay disabled. Promoting them blind ships exactly the thing that was held.

**2. San Jose's 13 steps are untouched and dormant, and must be re-seeded from the
corrected master, never hand-edited.** Hand edits fork San Jose from the master and
create the very drift the two-way preset sync work exists to fix. San Jose client id:
`5576acf0-acd3-4c05-9f9f-ebfde8618154`.

## Related

- Canonical defaults: `bam-ghl-agent/bam-portal/api/form-intro-automations.js`
- Divergence checker: `bam-ghl-agent/bam-portal/scripts/check-automation-divergence.mjs`
  (detects an academy drifting FROM the master, never the master lagging behind GTA -
  that one-way blind spot is what let onboarding ship at 3 steps against GTA's 8)

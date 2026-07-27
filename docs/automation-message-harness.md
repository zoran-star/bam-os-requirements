# Automation message render harness

`scripts/render-messages.mjs`

Renders every automation message an academy would send, **exactly as a parent receives
it**, and writes the review page staff work from.

```bash
# no database access needed
node scripts/render-messages.mjs --data scripts/snapshots/bam-gta.json

# live, needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
node scripts/render-messages.mjs --name "BAM San Jose"
node scripts/render-messages.mjs --client 39875f07-0a4b-4429-a201-2249bc1f24df

# with the photocopy / swap / custom markup layered on
node scripts/render-messages.mjs --data scripts/snapshots/bam-gta.json \
  --annotate scripts/annotations/bam-gta.mjs
```

Writes `docs/plans/review/index.html` (override with `--out`) plus one file per email
under `msg/`.

Read-only. It cannot enable, approve, or send anything.

## One renderer, deliberately

There were briefly three: a GTA-pinned annotator, a San Jose-pinned previewer
(`sj-message-preview.mjs`, PR #1615), and a parameterised one. All three rendered the same
thing through the same modules. Consolidated 2026-07-27 into this single script; the other
two are deleted. If you find yourself writing a fourth, parameterise this one instead.

| Piece | Where it lives |
|---|---|
| The renderer | `scripts/render-messages.mjs` |
| Markup engine, optional | `scripts/lib/annotate.mjs` |
| Per-academy markup rules | `scripts/annotations/<academy>.mjs` |
| Offline fixtures | `scripts/snapshots/<academy>.json` |

## What makes it trustworthy

It imports the REAL production send path rather than approximating it:

| Piece | Source |
|---|---|
| `renderEmail`, `resolveMergeVars`, `locFor`, `clientVars` | `bam-ghl-agent/bam-portal/api/email-shells.js` |
| The designed emails | `api/email-templates/nurture-emails.js`, `onboarding-emails.js` |
| How `vars` are assembled | mirrors `api/automations.js` (`{ first_name, full_name, athlete, next_session, ...clientVars(client) }`) |

SMS renders through `resolveMergeVars` the same way `api/_send.js` does. Emails render
through `renderEmail`, so `template:<key>` refs resolve, the branded shell fills with the
academy's own identity, and empty-token link dropping behaves as it does in a real send.

## What the review page gives staff

- A switcher across every automation, one automation on screen at a time.
- Every message in send order, with the wait before it. SMS as phone bubbles, emails as
  real HTML in a frame.
- A **stable reference on every message** (`CON1`, `GHO3`, `NUR2`, `ONB1`) so a note can
  point at something exactly instead of "the second paragraph in the third email".
- Disabled steps visibly marked rather than quietly absent.
- **A "did not render, and why" block.** The one thing staff cannot see by reading the
  email is a block that vanished because a fact was missing. That list is the point.

This is the surface phase 6 of the two email skills hands to staff, and the same page the
academy owner approves from in the wizard. One page, two audiences, different verbs: staff
leaves notes, the owner approves.

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

## Snapshots

A snapshot is `{client, automations:[{automation_key, name, enabled, approved, steps:[…]}]}`,
so the page rebuilds with no database access. Useful for reviewing on a machine without
service-role credentials, and for keeping a before/after pair across a preset change.

Regenerate one by running with `--client` or `--name` where creds are available.

## Annotation, optional

`--annotate` marks up every run of text in every email with a verdict, so nothing is left
unmarked: **photocopy** travels untouched, **swap** travels once a fact is collected,
**custom** is authored per academy. Each email declares a base verdict covering all of its
text, and rules override specific runs.

Unmarked text reads as "already fine" when usually it just has not been looked at, which
is why the markup is total rather than selective.

## ⚠️ Two things that must survive

**1. The testimonials emails do not ship without real testimonials.** `nurture-3` and
`onboarding-testimonials` quote real BAM GTA parents, re-attributed to whatever academy
sends them via `{{location.city}}` ("Parent of Adam, {{location.city}}").

> **Superseded ruling, 2026-07-27.** An earlier note here specified a *quote-free variant*
> that still sent with the quote block dropped. Zoran later ruled the simpler thing: an
> empty testimonials store means **the email does not ship at all**, and it returns once
> real testimonials are typed in. There is no quote-free variant to build. This also takes
> the Google Business Profile work off the critical path entirely.

Until the `testimonials` table exists and holds real entries for an academy, these steps
stay disabled. Promoting them blind ships exactly the thing that was held.

**2. San Jose's steps are dormant and must be re-seeded, never hand-edited.** Hand edits
fork San Jose from the master and create the very drift this workstream exists to fix.
Re-seeding is **diff-and-patch, never delete-and-recreate**: San Jose's `nurture-3` is
`enabled:false` deliberately and a naive re-seed re-enables it. Add missing steps by key
and position; never touch an existing row's `enabled` flag. San Jose client id:
`5576acf0-acd3-4c05-9f9f-ebfde8618154`.

## Related

- Canonical defaults: `bam-ghl-agent/bam-portal/api/form-intro-automations.js`
- Divergence checker: `bam-ghl-agent/bam-portal/scripts/check-automation-divergence.mjs`
  (detects an academy drifting FROM the master, never the master lagging behind GTA -
  that one-way blind spot is what let onboarding ship at 3 steps against GTA's 8)
- The templating plan: `docs/plans/email-skill-rework.html`
- The classification: `docs/plans/gta-automation-map.html`

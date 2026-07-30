# Deferred edit: the age range on a class

**Status: NOT APPLIED.** `bam-ghl-agent/bam-portal/public/client-portal.html` was
left untouched on purpose, because other sessions may be in that file. This is
the exact edit, ready to paste, once the orchestrator gives clearance.

Everything else in build A is done and green. This is the only piece outstanding,
and nothing depends on it at runtime yet: the resolver already reads these three
fields and already copes with all of them being absent.

---

## Where

File: `bam-ghl-agent/bam-portal/public/client-portal.html`
Section: `{ id:'schedule', label:'Schedule', ... }`, the `classes` block_builder
(search for `key:'classes'`).

Line numbers are against `de39e25` / branch `claude/route-by-actual-age`. The
anchor text is unique in the file, so if the lines have shifted, match on the text.

## Before, lines 31735-31738

```js
          { key:'title', type:'text', label:'Title', required:true,
            hint:'e.g. "U10 Boys Beginner" or "Skills A"' },
          { key:'age', type:'text', label:'Age', required:true,
            hint:'e.g. "U10" or "Grades 5-8"' },
```

## After

```js
          { key:'title', type:'text', label:'Title', required:true,
            hint:'e.g. "U10 Boys Beginner" or "Skills A"' },
          { key:'age', type:'text', label:'Age', required:true,
            hint:'e.g. "U10" or "Grades 5-8"' },
          { key:'age_min', type:'number', label:'Youngest age',
            hint:'Inclusive. 8 means an 8 year old fits this class.' },
          { key:'age_max_mode', type:'check_one', label:'Is there an oldest age?',
            options:['Set an oldest age','No upper limit'] },
          { key:'age_max', type:'number', label:'Oldest age',
            dep:{ key:'age_max_mode', equals:'Set an oldest age' },
            hint:'Inclusive. 11 means an 11 year old still fits this class.' },
```

Note: **no `required:true` on any of the three**, and the two oldest-age fields
carry **distinct labels**. Both were corrections, explained below.

Also change the summary line so an owner can see the range without opening the
row.

### Before, line 31732

```js
        summaryKeys:['title','age','skill_level','gender'],
```

### After

```js
        summaryKeys:['title','age','age_min','age_max','skill_level','gender'],
```

`_bbBlockSummaryHtml` (`client-portal.html:33013-33033`) renders each key as
`<label>: <value>` and **skips empty values entirely**, so a class with no upper
limit collapses to `Youngest age: 14` rather than showing a blank. That reads
correctly. `age_max_mode` is deliberately left out of the summary: its label
makes a clumsy prefix ("Is there an oldest age?: No upper limit").

## Why it is written this way

**Three fields, not two.** The obvious version is `age_min` and `age_max`, with
"leave the max blank for no limit". That version has a hole: a blank box also
means "I have not filled this in yet". An owner who tabs past the max on a
beginners class silently ships a class that accepts a 40 year old, and the screen
looks identical to one that was set up correctly. So the owner picks whether
there IS an oldest age before typing one, and the number box only appears when
they said there is.

**`age_max_mode` beats a stranded `age_max`.** An owner who types 18 and then
switches the toggle to "No upper limit" leaves the 18 sitting in the row, because
`dep` hides a field, it does not clear it. `classAgeRange()` in
`api/agent/_class-routing.js` treats the mode as the authority and ignores the
stranded number. This is pinned by `MUTATE=strandedmax` in
`api/_class-routing.test.mjs`.

**"No upper limit" is not optional.** BAM GTA's real second group is "ages 14 and
up". Forcing every class to carry a top number would change GTA's live behaviour,
which is forbidden.

**The free-text `age` field stays.** It is what the parent-facing copy shows. The
numbers are for the machine. This is an addition, not a replacement.

**What that field actually holds today, queried from production 2026-07-30:**

| academy | class | `age` | `age_min` | `age_max` |
|---|---|---|---|---|
| BAM GTA | Group 1 | Elementary School | NULL | NULL |
| BAM GTA | Group 2 | High School | NULL | NULL |
| San Jose | Beginner Academy | **Elementary School** | NULL | NULL |
| San Jose | Elementary Academy | **Elementary School** | NULL | NULL |
| San Jose | Pre-Season Academy | Middle / High School | NULL | NULL |

Two things fall out of that, and both are arguments for this patch rather than
against it. **Two of San Jose's three classes carry identical `age` text**, so
the existing field cannot distinguish them at all and no smarter parser ever
could. And **nobody anywhere has typed a number**: GTA's real bands, 9 to 13 and
14 and up, exist in exactly one place in the system, the hardcoded prompt text
that build B is scheduled to delete. Until these fields ship and someone fills
them in, deleting that prompt text destroys the only record of GTA's age policy.
That is build B's problem, but it is this patch that unblocks it.

**Overlapping ranges are legal.** Two classes can both cover an 11 year old. The
resolver returns both and the agent asks one question.

## Why there is no `required:true` (corrected)

**An earlier version of this file said `required` only marks a field with a `*`
and feeds completeness scoring, and flagged that as unverified. It was verified,
and it was wrong. `required` BLOCKS.**

What actually happens: `_bbValidateOfferRequired` (`client-portal.html:26902-26928`)
walks every field in a section, including block_builder subFields on every row,
and `_bbSectionMarkDone` (`26956-26970`) hard-blocks the "I'm done with Offers"
gate on the result. So `required:true` on these three fields would mean **San
Jose cannot mark Schedule done until three new fields are filled in on every
class**, and the same for any academy that re-marks a section. San Jose is mid-
onboarding. That is a launch blocker introduced by a field nobody has been asked
about yet.

Two things it does NOT do, which is why the damage is bounded: it does not block
**saving**, and it does not retroactively invalidate a section already marked
done. So the 40-odd academies already past that gate are untouched.

**So: no `required` on any of the three.** This was my own stated fallback and it
is now the plan, not the contingency. An unset range means "no bounds", which
fits everyone, which is exactly today's behaviour, so nothing breaks while the
field is empty. The nudge comes from the gap warning below instead, which is
where it belongs: a warning that names a consequence beats a gate that names a
missing field.

**If someone later wants these mandatory**, the right moment is the arming gate
for the free-trial preset, not the offers wizard - the rule Zoran already set is
that academy data is mandatory before the preset can be turned on. That gate
fires when the numbers actually start mattering, rather than trapping an owner
who is still filling in their schedule.

## Why the two oldest-age fields have different labels

`age_max_mode` and `age_max` both used to be labelled "Oldest age". Beyond being
confusing on screen, `_bbValidateOfferRequired` reports a blocker by its label,
so both would have read `Schedule: Classes #1 - Oldest age` and an owner could
not tell which one it meant. The toggle is now **"Is there an oldest age?"** and
only the number box is **"Oldest age"**. Worth keeping distinct even without
`required`, since the same labels drive the completeness chips.

---

## The gap warning: where it goes, not built in this pass

`ageCoverageGaps(classes)` already exists in `api/agent/_class-routing.js` and
returns the inclusive age spans that fall between an academy's classes. Nothing
renders it yet. Proposed placement, for a later pass:

**1. Inline, under the Classes block builder, in the Schedule section.** A
warning strip, gold not red, appearing only when `ageCoverageGaps()` is non-empty:

> **Nobody covers age 12.** A 12 year old who asks to book will be told they are
> not eligible. Widen Beginner to 12, or widen Pre-Season down to 12.

This is where the owner is already looking when they cause the gap, so it is the
cheapest possible moment to fix it.

**2. On the booking go-live card** (`__booking_golive__`, same section), as a
line in its readiness list. That is the moment the gap starts costing real
bookings, and the owner may have set the classes up weeks earlier.

Design notes for whoever builds it:

- **It is a warning, never a blocker.** A gap can be deliberate. An academy that
  runs 8-11 and 14-18 and genuinely does not serve 12s is allowed to exist. The
  warning must be dismissible or simply ignorable.
- **Only interior gaps.** Below the youngest class and above the oldest are the
  edges of who the academy serves, not gaps. A 4 year old is supposed to fit
  nothing. `ageCoverageGaps()` already reports interior spans only.
- **Say the consequence, not the condition.** "Ages 12 to 13 fit no class" is a
  fact. "A 12 year old who asks to book will be told they are not eligible" is
  the thing that makes an owner act.
- `resolveClassesForAge()` also returns a `problems` array covering two other
  owner mistakes worth showing in the same strip: a youngest above the oldest
  (fits nobody) and "there is an oldest age" with no number typed.

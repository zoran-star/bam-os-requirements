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
          { key:'age_min', type:'number', label:'Youngest age', required:true,
            hint:'Inclusive. 8 means an 8 year old fits this class.' },
          { key:'age_max_mode', type:'check_one', label:'Oldest age', required:true,
            options:['Set an oldest age','No upper limit'] },
          { key:'age_max', type:'number', label:'Oldest age', required:true,
            dep:{ key:'age_max_mode', equals:'Set an oldest age' },
            hint:'Inclusive. 11 means an 11 year old still fits this class.' },
```

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

**The free-text `age` field stays.** It is what the parent-facing copy shows
("U10", "Grades 5-8"). The two numbers are for the machine. This is an addition,
not a replacement.

**Overlapping ranges are legal.** Two classes can both cover an 11 year old. The
resolver returns both and the agent asks one question.

## `required:true` on existing academies

`required` in this wizard marks the field with a `*` and feeds completeness
scoring. It does not retroactively invalidate a saved offer, so the 40-odd
academies that already have classes keep working: an unset range means "no
bounds", which fits everyone, which is exactly today's behaviour. What changes is
that their Schedule section starts reading as incomplete until the owner fills it
in, which is the intended nudge.

**Check this before applying.** If `required:true` on a block_builder subField
turns out to block saving or block the booking go-live card rather than just
marking the field, drop `required` from all three and let the gap warning below
carry the nudge instead. I did not verify the blocking behaviour.

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

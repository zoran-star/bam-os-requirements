# The slot the message NAMES vs the slot the card BOOKS

2026-08-04. A pending BAM GTA Booking card offered Julie Boulton:

> "The first open spot the week of Aug 18 is **Monday the 18th** at 7:00 PM at Linbrook"

Its `book_slot_at` was `2026-08-18T23:00Z` = **Tuesday** Aug 18 in Toronto. Monday
was the 17th (also open, same class). Right date, right time, right class, wrong
weekday. Had it sent, a parent who had just rearranged a week around a sick kid
would have shown up a day early.

## Why every check we had passed it

`normalizeProposal` (api/agent-approvals.js) verifies **the timestamp**: is this
ISO time a genuinely open slot, per a live `freeSlots` read? It was. So the card
was stamped as carrying a verified slot. Nothing ever read the sentence - and the
sentence is the half that reaches the parent. Textbook
[[assurance_without_connection]]: a check that exists, is trusted, and is not
wired to the failure it is assumed to prevent.

## The 2026-07-13 near-miss (important)

Zoran hit this SAME disagreement in July ("message named Tuesday, box showed
Wednesday") and the fix was to **stop showing the slot box on proposal cards**.
That removed the display of the conflict, not the conflict. The slot kept riding
the card silently and kept pre-filling the later Book-it card - so the wrong time
was still the one that got booked, just invisibly. When a mismatch keeps
appearing, hiding the mismatched value is the wrong move.

## The guard (shipped)

**`api/agent/_slot-text.js`** - `slotTextConflict(text, slotIso, timeZone)`.
Renders the slot in the ACADEMY's timezone and returns null (agreement) or a
human sentence naming the disagreement.

Two narrow rules, because **false positives block sends**:
- **Weekday** - text names weekday(s) and the slot's is not among them. "Monday
  or Tuesday" is fine if the stamped day is one of them (a real choice).
- **Date** - a day number sitting next to a weekday or month ("Monday the 18th",
  "Aug 18"). A bare ordinal is ignored: "your 1st session" is not a date.
- **Clock times are NOT checked.** "7-8pm" / "after 6" / "around 7" generate more
  wrong answers than they catch.

It does **not** repair the text. When the words and the timestamp disagree we
cannot know which the model meant (Monday the 17th? Tuesday the 18th?), so
rewriting would swap a visible error for an invisible one. A human already
approves every one of these cards - tell them.

Wired in three places:
- **`list-ready`** stamps `slot_text_warning` at READ time (no column, no
  migration) - which is why it caught Julie's card, drafted before the guard
  existed. A draft-time-only check would have missed the very card that motivated it.
- **`send`** and **`confirm-book`** return **409** with that sentence.
  `confirm-book` matters most: it books AND texts the confirmation.
- **Deck** shows a red banner above the draft on both proposal and Book-it cards.

Suite: `node bam-portal/scripts/verify-slot-text.mjs` - case 0 is Julie's real
text, and most of the rest assert NO conflict (street numbers, "1st session",
clock times, two-day offers).

## If you extend it
Add rules only where the text makes an **unambiguous** claim. Anything fuzzy must
resolve to "no conflict" - a blocked send on a good card costs more than a missed
weekday, because staff learn to distrust the warning.

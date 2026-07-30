# Handoff: automation templating, 2026-07-30

Supersedes `automation-templating.md` (2026-07-29), which is kept for the earlier history.
Read this top to bottom. The last section is the only part needing a human.

---

## The one-paragraph version

The free trial sales system is templated: pipeline, agent behaviour, all 9 agent facts, email
identity, 11 of 17 messages. What is left for a human is content (3 email designs, funnel copy) and
consent (the owner's 3 approvals). **This session was almost entirely about finding places where ONE
academy's identity had been baked into something SHARED.** The durable output is not the fixes; it is
the checks that make the next one fail loudly.

---

## Live in production

- **Reignition** - a third front door into any sales system. Hand-picked roster, paced admission,
  staff-run. Migration APPLIED. No UI yet.
- **The owner approval gate** - the five sales sequences cannot go live without the OWNER approving.
  A teammate holding `can_train_agent` is an operator, not the person being asked.
- **The business/owner email split** - an academy's public email is its own field. Zoran's personal
  inbox is no longer the contact and unsubscribe address on every GTA email.
- **GTA's `LOCATIONS` hardcode deleted** - email identity now comes from the row for every academy.
- **The eslint gate** (`no-undef` on `api/`), plus CI that actually runs the suites and judges their
  negative controls.

**Six live bugs fixed, all found while doing something else:**

| Bug | Notes |
|---|---|
| Opening the automations panel silently ARMED a sales sequence | `approved:true` hardcoded in the panel's seed list |
| A worker crash that retried forever | `const` in a `try`, read from the `catch`; the crash skipped the attempts counter so a 15-min reaper re-queued the same job indefinitely |
| Staff ticket replies erroring since **June 8** | Reply saved, Slack fired, then 500 |
| Empty calendar returned a crash instead of "no times" | Only when empty, i.e. exactly when debugging |
| Consent bankable over an EMPTY sequence | Then a routine re-seed filled and armed it |
| Four confirmation emails shipped a **blank footer** | Including `"You're receiving this because you enquired about ."` |

---

## The identity leaks, which are the real story

Five found. Same shape every time: one academy's identity inside a SHARED default.

| Leak | Reach | State |
|---|---|---|
| GTA's Google review link in the agent prompt | **0 of 47** academies overrode it | fixed, live |
| GTA's address, Oakville qualification rule, coach credential | **32 of 47** shipping all three | fixed, PR #1656 |
| GTA's name hardcoded in a SHARED nurture template | every academy's footer | fixed, PR #1656 |
| GTA's door directions in the trial-confirmation SMS | any academy with a booked trial | fixed, PR #1656 |
| **`booking_group`: GTA's ages 9-13 / 14+** | every academy | **STILL LIVE, deliberately** |

**Why the door one was the worst shape:** for an academy with no address the real Location line DROPS
OUT and the borrowed door SURVIVES. The parent is told nothing about where to go, then told
confidently about a door in Oakville. Now `{{appointment.entry_note}}`, resolved from the booked
venue's own row, dropping its line when empty. GTA seeded, San Jose empty.

**Why `booking_group` cannot just be emptied:** it is NOT in `FACT_KEYS`. It has no renderer, so
filling in an academy's offer can never clear it - unlike every other leak, nothing is arriving to
replace it. And emptying it removes ONE OF FOUR copies (the same bands are restated in three tool
schemas) while breaking calendar routing entirely. Strictly worse on both axes. It needs the build
below.

---

## Designed, NOT started: route by actual age

**The problem.** The agent picks a lead's class by pattern-matching the CALENDAR'S NAME for
`group 1|elementary|younger` / `group 2|high school|older`. Those are GTA's naming conventions.
Measured: of six production trial calendars only GTA's two match. San Jose has three programmes and
exactly one matches, by accident.

**Zoran's decisions (2026-07-30):**
1. Route on **actual age**, per class, as numbers.
2. **Remove "Group 1 / Group 2" entirely.** The agent works in real class names.
3. **Real class names in what parents see.** A GTA parent currently sees "Training - Group 1
   (Mon, Tue, Wed, Thu)" - an internal label that leaked out.
4. **One shared resolver** across all three booking paths (agent, website, DETAIL Miami's endpoint).

**Miss handling, his rule:** exactly one class fits, book it. **No class fits, they are unqualified.**
MORE than one fits, the agent **asks one question** - it is a conversation. San Jose genuinely has
two classes matching a 9-year-old beginner, because "All" skill includes beginners and skill is not
collected on the form.

**Research findings that make this smaller than it looks:**

- `schedule_slots.source_offer_class_key` **already exists, is indexed, and is copied template to
  slot**. NULL everywhere because one whitelist (`api/runtime/schedule/templates.ts`) silently drops
  it on create. The pipe runs end to end with the inlet valve capped.
- `offerToTemplatePayloads` (`api/_offer-schedule.js`) has the class in hand and emits only its TITLE
  inside a string; `age`, `skill_level`, `gender` are dropped.
- **Classes have no numeric age**, only a school-stage LABEL. And that label means different ages in
  Ontario and California, so any label-to-number mapping is wrong for one of them. Hence numbers on
  the class, entered by the owner.
- `athlete_age` arrives as **free text** - a plain text box accepts `"9"`, `"nine"`, `"9 turning 10"`,
  and the only coercion falls back to the raw string.
- **On a miss all three paths fall back to `rows[0]`** and book an ARBITRARY class at that time.
  San Jose runs Beginner 5-6pm and Elementary 6-7pm back to back, so this is a real misbooking
  waiting to happen.
- **Nothing tests the routing core.**

Full blast radius, including the five separate label parsers and three booking write paths, is in
this session's exploration notes; re-derive with a fresh Explore pass if needed.

---

## San Jose: what is actually blocking launch

Measured against production. Full detail: `docs/plans/san-jose-preflight.html`.

**Solid:** all 13 messages seeded and tokenized with ZERO hardcoded academy names; nothing can send
(every automation `approved:false`); its testimonial email carries its OWN 5 real quotes and
mechanically cannot carry GTA's; identity facts correct on the row; **schedule entered correctly**,
including a Friday session GHL did not have.

> **GHL is the stale copy. Do not seed the schedule from it.** Its calendars had Beginner an hour
> late and no Friday at all. The offer is right.

**Blocked:**

| | |
|---|---|
| **Free-trial page** | Built this session in `bam-client-sites`, NOT merged. Every automation fires off it |
| **Stripe** | Not connected. Blocks prices, the enroll page, the pricing fact, AND slot generation |
| **Schedule slots** | 0. Generation refuses without a bookable programme, which needs Stripe |
| **Coach bios** | 4 team members, 0 bios |
| **`allowed_domains` is NULL** | Testimonials will 403 in production. Works locally, breaks live |
| **No `entry_points` row for free-trial** | Leads land in `website_leads` and **nothing tags or routes them** |
| **Pipeline seeding** | 65 imported leads. Classification design (direct / altered / quarantined) is the last undesigned piece |

---

## State of the code

- **PR #1656 OPEN** - name tokenizing, footer fix, fallback removal, board v7, San Jose pre-flight.
  Branch `claude/tokenize-academy-name`, 6 ahead, 0 behind main.
- **26 suites, ~156 negative controls.** CI runs them and judges the controls.
- **Three migrations pending, none applied:** the three GTA message rows that hand-type the academy
  name, the venue entry note, and a ticket-intake one that is not ours.
- **In flight when this was written:** a lock on the four confirmation emails, display-time typography
  normalisation for stored testimonials, and an identity-leak gate over every shared default.

---

## The method, which matters more than any single fix

Every fix came from one failure shape, named in
`memories/reference_assurance_without_connection.md`: **a thing whose whole purpose is confidence,
trusted because it exists, never wired to the outcome it claims.** Nine instances now.

What actually caught things:

- **Render the real output; never trust a grep.** A string can be absent from a file and still reach
  output through a fallback, and can be PRESENT purely in a comment explaining its own removal. Both
  false readings happened today.
- **Break it before writing the comment saying it is caught.** One control inserted a duplicate
  `"body"` key; JS takes the last one, so the module exported the identical value and the control
  passed while proving nothing.
- **A control counts only when the run PRINTS `NEGATIVE CONTROL PASSED`.** A non-zero exit is not
  proof - a suite also exits non-zero when a mutation matches nothing.
- **The measurement lies as often as the code.** Five false alarms today, every one confident and
  specific: a `zsh` loop that did not word-split reported all 30 controls caught; `| tail` returned
  tail's status; `echo "$(basename $f) exit=$?"` reset `$?`; a stale local `main` ref reported main
  red; an extraction without `node_modules` reported 9 red suites. **Read the failure text, not the
  exit code.**
- **Ask "what would make this fail", never "does it pass".**

**Practical:** do not run several sessions in one checkout. `git add -A` swept another session's work
into a commit under the wrong headline, twice in one day. Use `scripts/wt`.

---

## What needs a human

1. **The four pipeline-seeding questions** - the last undesigned piece. Classification rule, whether
   altered leads auto-enrol, whether the agent speaks first, who signs off.
2. **Two business phone numbers** for the business-contact gate (`docs/plans/business-contact-split.html`).
3. **Apply the three pending migrations.**
4. **iOS push on ticket replies** - fixing the June 8 bug wakes a notification that has never fired,
   so owners with the app start getting pinged.
5. **The `RECEIPT` example** in the shared prompt carries GTA's real live price ($315.27) and Ontario
   `HST (13%)`. Guarded, but HST does not exist in California, so a San Jose agent imitating the
   label states a foreign tax regime. Changing it touches shared craft for all 47 academies.

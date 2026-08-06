# Member management: San Jose handoff, 2026-08-06

Written cold for the next chat. Assumes nothing. **Read top to bottom before acting.**

---

## YOUR FIRST ACTION: RUN THE REHEARSAL

Everything is built and verified. Nothing has been sent to Lij. The next step is a full dress rehearsal with a subagent playing him, and it is unblocked.

**Zoran's instruction, verbatim in effect:** run the rehearsal, and if it finds bugs, use an agent team loop:

```
   REHEARSAL agent  -- finds a bug -->  PLANNER agent
                                             |
                                             v
                                        BUILDER agent
                                             |
                                             v
                                        TESTER agent
                                          /       \
                                    fails          passes
                                       |              |
                                  back to         back to REHEARSAL,
                                  PLANNER         FROM THE TOP
```

Rules that make the loop honest, carried from this session:
- **The tester never built the thing.** Different agent, every time. 11+ defects were caught this way and 0 shipped.
- **Negative controls must PRINT when they catch.** A silent non-zero exit does not count. Three decorative controls were found today, each by something printing rather than by anyone reading code.
- **A control that patches more than one line cannot give a per-line answer.** Split it and check each half. That technique found two fakes today.
- **Verify before acting on a claim, especially a frightening one.** Render or execute; never grep and conclude.
- **Say what you did not verify.**

---

## ⛔ ZORAN'S CORRECTION, 2026-08-06, and it reshapes the design

> "we have to have the skill ready to go without this, since we won't be using the training onboarding wizard for future clients"

Said in response to a table row that read *"You review: I walk you through what he sent, one plan at a time."*

**That was wrong and it is the thing to fix.** The review walkthrough must be **the skill itself**, self-contained, runnable by anyone with no prior context. It must not depend on a chat that happens to know this week's history. And **future academies will not go through the training onboarding wizard**, so the skill cannot assume anything the wizard would have set up.

**Open question for Zoran** (do not guess): does "the training onboarding wizard" mean the `_obf*` paged owner-onboarding flow in `public/client-portal.html`, and if so, what replaces it for future academies - the workbooks alone, or something else? The answer changes what the skill can assume exists.

---

## WHERE SAN JOSE ACTUALLY IS

The 9-step sequence, and the truth about each:

| # | Step | State |
|---|---|---|
| 1 | Connect his Stripe | **DONE**, proven in production |
| 2 | Work out what he charges | **DONE**, 4 plans, every live price classified |
| 3 | Send him the price workbook | **BUILT AND DEPLOYED. NOT SENT.** |
| 4 | He confirms his prices | waiting on 3 |
| 5 | Staff review | **BUILT** (`review`, `approve-card`) |
| 6 | Apply it to live pricing | **BUILT, dry-run only.** Live apply deliberately refuses |
| 7 | Member workbook | designed and locked by Zoran, **zero code** |
| 8 | Seed his 20 members | not started |
| 9 | Write the three skills | last, from the real run logs |

**Lij:** BAM San Jose, `client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154`, Stripe `acct_1RDtSMK6ZS1cqefu`, 20 live subscriptions, ~$4,640/month, reached through the direct-key transport because CoachIQ platform-locks his account.

**His workbook:** id `4ad292a0-e161-440e-9a22-1d0cec5164bf`, token `3481a721ba1eb5d1bcf716060efab151fa593cd5f9e180f2`, status `draft`, **8 cards / 7 counted, zero answers, zero confirms**. Verified blank at wind-down.

**It is live on the internet right now:** `https://portal.byanymeansbusiness.com/workbook.html?t=<token>`. Nobody has the link.

---

## HOW TO RUN THE REHEARSAL

The point: **find out whether the workbook collects enough BEFORE Lij answers it**, because asking him twice breaks the two-links rule and costs credibility with the academy we are using to prove the whole process.

1. A subagent plays Lij through the real page: accept a rename, edit one price, add one plan, answer tax.
2. Submit.
3. Staff half: `review`, then `approve-card` per card, then `apply` with **dry_run true** (the default, and `dry_run:false` refuses by design this pass).
4. Check: does the offer come out right, do the imported prices look right, what would the sales agent quote, and **is there anything we forgot to ask him**.
5. **Reset to blank.** Wipe answers, clear confirms and approvals, status back to `draft`. Verify with a read-back, exactly as was done at wind-down.

**Zoran's ruling on the Stripe boundary: DRY RUN.** The rehearsal stops at his Stripe's door and prints what it would create. His account is never touched.

Two facts that shape what phase 3 should say:
- **All ten of his amounts already exist in his Stripe.** If tax is No, the answer is match-not-mint, zero new prices. If tax is Yes, all-in amounts differ and a whole new set would be minted. **His tax answer decides which path runs.**
- **His offer has never been wired.** `offer_prices` is EMPTY, the offer is still `draft`. Phase 3 is not "update pricing", it is the first time anything gets connected at all.

---

## WHAT WAS BUILT SINCE THE LAST HANDOFF

**The workbook page + API** (`public/workbook.html`, `api/workbook.js`) - owner-facing, tokenized, no login. Saves as he types. Send refuses until all 7 cards are confirmed.

**The review-and-apply engine** - `review`, `approve-card`, `apply`, `publish`, `rollback`. Staff-authed, named by `workbook_id`, dispatched before the token is read. Phase order is load-bearing: snapshot (first-wins) -> tax (because `applyFee` bakes it into minted amounts) -> offer writes (vocabulary-translated, `applied_at` per answer so a rerun resumes) -> dry-run preview.

**Adjustable prepay lengths** - the term vocabulary was closed to 3 and 6 months; 12 collapsed to 6 and 9 vanished entirely. Now any 1-24 months, out-of-range refuses loudly, and **mints honour the academy's declared week rhythm** ("3 Months (12 Weeks)" mints as 12 weeks, not 3 calendar months). 19 consumers chased to a verdict.

**The contract test** (`scripts/verify-workbook-contract.mjs`) - runs the REAL page against the REAL handler, stubbing only the database. **It is the only thing that can see the two halves disagreeing**, which is where 6 of 8 defects came from. Extended to cover the staff actions.

### Migrations, all applied to prod and read-back verified
`20260804T230000_workbooks.sql` (workbooks, workbook_cards, workbook_answers - RLS on, zero policies, service-role only, **RLS proven by inserting a real row and failing to read it with the browser key**), `20260805T003000_workbook_extras.sql` (`current_value`, `meta`), `20260806T063000_workbook_apply.sql` (`snapshot`, `approved_at`, `approved_by`).

### Gates, all green at wind-down
| | |
|---|---|
| `api/_workbook-apply.test.mjs` | 133, 19 controls |
| `api/_workbook.test.mjs` | 165, 26 controls |
| `scripts/verify-workbook-contract.mjs` | 111 |
| `api/_term-vocab.test.mjs` | 243 |
| `api/_billing-cadence.test.mjs` | 296 |
| `api/_discount-notes-never-quoted.test.mjs` | 29 |
| `scripts/credential-header-scan.mjs` | manifest matches, 590 raw baseline |

---

## DEFECTS FOUND, because the pattern matters more than the list

Every one of these was **a confident answer where the honest answer was "I could not tell"**:

| Found | Would have meant |
|---|---|
| A rename landing on an **archived** plan sharing the old name | The live plan 9 members pay on keeps its old price. Reports success. Rerun does nothing |
| A card typed into but **never confirmed** passed the Send gate | The every-row-confirmed ruling defeated on first real use |
| Prepay options read **"no saving"** | A 3-month deal that saves $151 looked pointless |
| The $40 fee read **"charge"** on every prepay option | Opposite of the ruling and of his own Stripe |
| **Phantom money changes** - retyping the same price recorded `300 -> 300` | Fake changes for staff to adjudicate |
| A failed database read reported as **an empty read** | "Mint everything" for prices that already exist |
| `.arch` class collision **hid archived plans after submit** | The copy he gets back is missing plans he archived |
| **NOSETUP** - a discount code we invented | It appears in NO client data. It was a field name WE wrote |
| The sales agent quoting **owner-typed arithmetic** to parents | Four of six notes wrong; one said $240/mo for a $250/mo plan |
| Page counted 8 cards, server counted 7 | Owner told to confirm a card holding nothing |

**Three decorative controls** were found and fixed, each by something printing rather than by review.

---

## ZORAN'S RULINGS (this session, additive to the previous handoff)

| Ruling | |
|---|---|
| Special deals | Move to the **member** workbook. Christopher's $199 and Keanu's $100 are arrangements with a person, not plans |
| Add-ons | **Cut.** He sells none, so the card could only answer "none" - a mandatory click that teaches nothing |
| Header name | `clients.public_name` = "By Any Means San Jose", not hardcoded |
| Elementary | Keeps its $40 fee. **And gained $499/$999 prepay** - real in his Stripe, zero takers, and we had included 1x/week's unsold rungs while dropping these |
| Tax | **Everything is always taxed, joining fee included.** The three per-plan exemption questions are REMOVED, not hidden |
| `discount_notes` | A note to our team, **never copy**. Removed from the sales agent's script |
| `club` | His one real coupon ($100 off, forever, never used) goes in the workbook. NOSETUP was ours |
| The add buttons | Keep them. What they produce is a **REQUEST**, never a write. Staff creates it by hand |
| Rehearsal | **Dry run** at the Stripe boundary |
| Publish | A **separate deliberate step**, never buried inside apply |
| The review skill | **Must be standalone**, not a chat walkthrough (see the correction above) |

---

## TRAPS

1. **The offer stores vocabulary LOWERCASE** ("waive"), the page's chips are capitalised. This silently told the owner we charge his $40 on every prepay option. Fixed in two places; assume it recurs.
2. **Everything bills every 4 weeks**, the schema thinks in months. Broke the savings maths; will break coupon durations.
3. **A local harness caches the API module at startup.** I left one running 22 hours across a dozen API changes and an agent reported two false defects from it. Restart it after every API change.
4. **`vercel env pull` values carry literal `\n`.** Parse, never source. Production's `SUPABASE_SERVICE_KEY` has a trailing newline (harmless, trimmed).
5. **The credential-header scan's heuristic is name-based** and can misread `throw bad(...)` as an assignment. A red scan is not necessarily a leak - diagnose before adding a manifest line, and **never silence it by declaring a leak that does not exist**.
6. **Agents stall.** Four did this session, always at 10 minutes of silence, usually mid-verification. Their work is normally intact; check the suites and resume them with a briefing on what changed while they were gone. Resuming is cheap and paid off twice.
7. `gh pr merge` fails with "not mergeable" while CI runs. Use `--auto`.

---

## STILL OPEN

- **The safety pass Zoran parked**: token guessing, cross-academy access, and whether text Lij types could run inside our staff portal (stored XSS). **The page is publicly reachable now**, so this stops being theoretical the moment the link is shared.
- **Coupons have nowhere to land in the portal.** `club` raised it; every academy will. Zoran asked for a proposal he can confirm. NOT YET WRITTEN.
- **The seed is hand-written SQL.** Academy #2 needs a tool that builds the workbook from their Stripe + offer. This is the heart of the future skill and the biggest template gap.
- **A 9-month addition** cannot be represented as a discount-code target from the page (`priceKeys` opens to any month, but check the round trip).
- **iOS Safari untested.** Zoran reviews on his phone.
- **Nothing has run against real Postgres.** Every gate so far used a stub. The rehearsal is the first real contact.

---

## HOW TO TALK TO ZORAN

ADHD, visual learner, hates reading. **Short and visual: tables, bullets, bold the key thing, ONE clear next action.** Mockups he can accept or reject in under two minutes, never specs. Use the question popup for decisions. **Never an em dash anywhere in person-facing output.** Do not offer to pause. **End every message with a two-line fun fact about Serbia not used before in that conversation.**

**He questions premises and is usually right to.** This session he caught: the $40 on prepay, a truncated label, Elementary's missing prepay ladder, NOSETUP, and an invented tax rate I presented as his answer. **Every one was something my tests said was fine.** When he asks "why did you say X", check rather than explain.

**Nothing reaches Lij except through Zoran.**

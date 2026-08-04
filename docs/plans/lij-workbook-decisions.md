# Lij Workbook - Decisions Log

Design room output. The build chat (MEMBER MANAGEMENT II) consumes this file.
Locked context: private link no login, staff confirms before anything applies, one-time tool, confident matches collapse, athlete core field is AGE only, no em dashes.

**Artifacts this room produced**
| File | What it is |
|---|---|
| `docs/plans/lij-workbook-mockup-v2.html` | THE canonical mockup. Light spreadsheet grid + focus mode + live price cards + the redesigned Adjust-prices overlay. Open it and click "Adjust prices". |
| `docs/plans/lij-workbook-mockup-v1.html` | Superseded. Dark card/question concept, rejected. Kept only to show what was ruled out. |
| `docs/workbook/sj-roster-2026-07-31.json` | Lij's real 20 live subscriptions, the data every mockup uses. |

**Where this sits in the 3-skill onboarding map:** primary = SKILL 2 "members workbook". Also owns the seam into SKILL 1's price workbook, since the Adjust-prices button opens the Blueprint Pricing step.

---

## 2026-08-01 - Scope, transfer, and the seeding ruling

**Scope confirmed (Zoran via MEMBER MANAGEMENT II):** this room DESIGNS AND BUILDS the member workbook itself, ships it through Zoran, captures Lij's edits as structured decisions, and hosts both Zoran's price-adjust tab work and the portal-created-vs-linked ruling. Skill authorship moved OUT of this room; MM II writes all three skills from this decisions file, so it must stay complete. Test Customer is folded in as an ordinary rejectable row, never a side question.

**Price page transferred out (2026-08-01).** The Adjust-prices page went to the SJ PRICE MATCH room, which now ships the price workbook to Lij from it. Sent: both file paths, the `_bbStdPricing` / `_obfWizOfferPage` source pointers, the five adopted fixes and the five declined, the two fragile mechanics, and the Academy-Unlimited-no-monthly-base finding.

**Theme ruling (MM II):** BOTH workbooks are LIGHT. Zoran chose light for the workbook surface and Lij gets one product family. Portal-dark applies only inside the portal itself.

**SEEDING IS NOT THIS ROOM'S JOB (Zoran, 2026-08-01).** Asked whether to seed the 20 members from Stripe now and let the workbook correct afterwards, or wait for Lij: "we dont do seeding in this chat because we have to wait for lij so just leave it for the orchestrator chat todo". Note for whoever writes skill 2: he answered a narrower question than the one asked. He removed seeding from this room's scope and gave "we have to wait for lij" as his reason, not as a program ruling. The Aug 5-7 renewals landing on members the portal does not yet know remains an open consequence with no owner named.

**Program-wide ruling adopted from this room's build plan (MM II):** "confirmed" must be a DELIBERATE ACT, distinct from "untouched". A row nobody read must never serialize the same as a row the owner approved. Do not let this be simplified away.

**MEMBER GRID LOCKED (Zoran, 2026-08-01): "Locked, build it."** The spreadsheet surface is final and the build proceeds from mockup v2: light theme, all rows visible at once, live prices grouped by plan family across the top, focus mode with the per-row check-off button on the far left.

## 2026-08-02 - Part 4 CLOSED: what Lij can edit

All six open design questions answered in one sitting. This is the build spec for the member workbook.

| # | Question | Zoran's ruling |
|---|---|---|
| 1 | Seed now and correct later, or wait for Lij? | Not this room's job. Seeding goes to the orchestrator chat. "we dont do seeding in this chat because we have to wait for lij" |
| 2 | "Not a member": junk row, or stop charging this parent? | **"stop charging this parent"** |
| 3 | Can Lij edit the dollar amount a parent pays? | **No. "only plan and date."** Prices are changed through the top-right button, not per member |
| 4 | Two athletes on one subscription? | **Yes** |
| 5 | Partial return, take the confirmed rows? | **No. "every row has to be confirmed, so put guardrails in the UI"** |
| 6 | The link has no login, so whoever holds it sees the full customer list | **"fine for now, we will change it in the future"** |

**What each ruling means for the build:**

- **Q2.** The not-a-member action carries a MONEY consequence, not just an import decision. It means the parent should stop being billed. It still never writes directly (staff-confirms is locked), so it lands on the proposed change list as an URGENT item with the dollar amount and the subscription id attached, because every day it waits is another day a parent may be charged. A row with no live subscription (Test Customer, duplicates) resolves to simply not importing, since there is nothing to stop.
- **Q3.** The money columns are READ ONLY in the grid. Editable per member: which plan they are on, and the next payment date. Price changes route to the prices page behind the top-right button. Zoran also flagged that the price-adjust tab has had significant work done in another chat and that chat will ping this room when it is finished.
- **Q4.** A subscription can hold more than one athlete. Each athlete carries its own name and AGE. The response format must therefore treat athletes as a list per row, never a single field.
- **Q5.** There is no partial submit. The send button stays blocked until every row is confirmed, with a visible count of what is left and a jump to the first unconfirmed row. This is the enforcement arm of the standing ruling that "confirmed" is a deliberate act distinct from "untouched": if partial returns were allowed, untouched rows would silently pass as approved.
- **Q6.** Accepted risk, revisit later. Recorded here so it is a decision with a date rather than an oversight.

**Orchestrator rulings on the three escalations (MM II, 2026-08-02):**
- **Q2, the stop-billing queue, is OWNED BY MM II**, since seeding is their job. Committed requirements this room builds to match: rows carry the dollar amount, subscription id, parent name and the date Lij marked them; they surface FIRST in staff review, above everything else, on blast-radius precedence; and working the queue is a REQUIRED step in skill 3, not optional cleanup. Reason given: "a queue nobody is obliged to clear is how a parent gets charged for four months after their kid quit."
- **Q5 is now PROGRAM-WIDE** and binds the PRICE workbook too, not just this one. No partial submit anywhere. One product, one rule.
- **Q6 goes into skill 2 as a NAMED LIMITATION with Zoran's words attached**, so the next academy meets a decision rather than a default. MM II asked this room to PROPOSE link-expiry-on-submit if it is cheap, but explicitly not to build it unasked, since Zoran ruled "fine for now".
- **Q3 confirms the single-surface rule**: the price-adjust tab is the ONLY way money changes. The price chat pings this room when theirs is done.
## Capture schema: how Lij's edits come back as DECISIONS

Designed in this room, never built and NEVER agreed with the price chat (they were sent the price page only). Written down here at wind-down so it is not lost. Treat as a proposal, not a contract.

The workbook returns one envelope. The point of the shape is that a Claude reads DECISIONS, not values:

```json
{
  "workbook": "member-setup", "academy": "san-jose",
  "returned_at": "<ISO>", "complete": true,
  "rows": [{
    "subscription_id": "sub_...", "customer_id": "cus_...", "contact_id": "...",
    "outcome": "confirmed" | "stop_billing",
    "confirmed_at": "<ISO>",
    "parent": { "name": {"was": "Christy Hang", "now": "Christy Hang"} },
    "athletes": [{"name": "Christopher", "age": 12, "source": "plan_name" | "ghl" | "typed"}],
    "plan":         {"was": "price_...", "now": "price_..."},
    "next_payment": {"was": "2026-08-20", "now": "2026-08-27"},
    "money": {"amount": 199, "cadence": "4 week", "editable": false},
    "changed_fields": ["athletes.0.age", "next_payment"]
  }],
  "additions": [{ "source": "stripe_search" | "manual_non_stripe", "...": "same row shape" }],
  "academy_values": {"confirmed": true, "corrections": {}}
}
```

Rules the shape enforces, each tied to a ruling:

| Rule | Why |
|---|---|
| `outcome` and `confirmed_at` are never absent | A row nobody read must not serialize identically to a row the owner approved. This is the program-wide confirmed-is-a-deliberate-act ruling made structural rather than trusted |
| Every editable field is `{was, now}`, never a bare value | A consuming Claude sees what CHANGED and can ask why. A bare value cannot be told apart from an unchanged default |
| `athletes` is always a list | Q4: two kids can sit on one subscription |
| `money.editable` is `false` | Q3: amounts are context for Lij's judgement, never a proposal. If a build ever makes them writable, this flag is the thing that should stop it |
| `stop_billing` rows carry amount, subscription id, parent name and marked date | MM II's committed requirement for the queue they own. These sort FIRST in staff review |
| `complete: true` is only reachable because partial submit is blocked | Q5. If partial returns were ever allowed, this field would become a lie rather than a fact |

- **Link-expiry-on-submit was PROPOSED to Zoran (2026-08-02) and NOT taken up.** His Q6 ruling stands unchanged: the link keeps working, "fine for now, we will change it in the future". Do not re-raise it; it has been put to him once and declined.

**PRICES PAGE BUILD DEFERRED (Zoran, 2026-08-01):** "hold off on building the adjust prices page until we finish the build in this chat [Walk through: SJ price match + skill] - let the orchestrator know." This is sequencing, not a design reversal: the price room builds the page once, and the workbook's Adjust-prices button later points at whatever they ship rather than at a second implementation of the same page.

---

## 2026-07-31 - Part 1: goals + phase 2 ruling

**Phase 2 ruling (link-only vs cancel+recreate):** Workbook 1 is link-only, zero Stripe writes. A SECOND workbook comes later to get every sub portal-created, and it only starts after workbook 1 is done AND coworking with the Claudes confirms the member import. His words: "we will create another workbook to go in and actually get the subs to be portal created, but thats done after this workbook and some coworking with our claudes to confirm the member import."

**Sequencing:** Workbook 1 ships only after prices are set and contacts are synced (sj-price-match and sj-contact-linkup rooms). Orchestrator chat sends status updates to this room.

**Workbook 1 user stories (Zoran's own list, verbatim intent):**

1. **See all members**: parent name, athlete name (from GHL athlete-name custom field if present), email, date started, sub name, last payment (click loads full payment history), next payment, payment status, link to that customer in Stripe.
2. **Add new members from search**: search Stripe's 147 customers, add one as a member, and see whether we can charge them in Stripe (saved payment method) or whether they use an alternate payment method.
3. **Adjust next payment and plan** per member. Any adjustment is FLAGGED when the workbook is sent back (proposed change list, staff confirms).
4. **Adjust prices button** top right: takes the owner to the prices onboarding page to fill out / correct and send back, so the Claudes can cowork the adjustment. Not an inline edit of live Stripe prices.
5. **Adjust all the names** (parent and athlete).
6. **Stripe deep link** per row for staff/Zoran to jump to the customer in Stripe.
7. **Onboarding custom values on display**: the core + extra custom values we normally collect at onboarding are shown in the workbook for double-checking. For Lij they should already be set; display them so Zoran can verify.

**Accepted additions (2026-07-31):**

8. **Multi-athlete rows**: a member can hold 2+ athletes; pre-extract athlete names from plan names like "Academy (Christopher) @ 199" where possible.
9. **Athlete age field**: Lij types each athlete's age in the workbook. AGE only, no DOB (locked ruling).
10. **Don't-import toggle, FLAGGED not dropped**: skipping a row does NOT make it disappear from our side. His words: "c has to be flagged cuz we might have to cancel their sub in the next workbook to make sure its fully clean." Skipped rows feed workbook 2's cleanup list.
11. **Add non-Stripe member**: manual add for cash/Zelle/free members not among the 147 Stripe customers.

Free-text note per row (candidate E) was offered and NOT selected.

## 2026-07-31 - Part 2: the Stripe pull list

Signed off with one amendment. Per member we pull:

- **Subscription**: plan name, amount, every, status, start date, next renewal, coupon/discount if any, cancel-at-period-end flag.
- **Customer**: name, email, phone, payment-method-on-file yes/no, balance/credit. Powers add-from-search "can we charge them or are they on an alternate payment method".
- **Invoices**: last payment on the row; click loads full payment history (date, amount, paid/failed/refunded).
- **Catalogue**: all 119 prices and which 14 are live, feeding the prices page behind the top-right button.
- **Deep link**: customer URL into his Stripe dashboard per row.
- Always show the **charged** amount (post-coupon) with a "deal" marker when a discount applies.

**Amendment (Zoran):** athlete AGE and the other onboarding custom values may ALSO exist as GHL custom fields. Pull them from GHL where present and prefill; the workbook is then a confirm, not a blank form. Fill order: GHL custom field, else plan-name extraction (athlete names), else Lij types it.

**End-of-room task (Zoran):** after this design wraps, capture the general flow and create a skill that designs member workbooks for any academy. His words: "at the end of this chat we'll have to remember the general flow and create a skill that designs member workbooks."

---

## 2026-07-31 - Part 3: presentation ruling (REPLACES the card/question concept)

Mockup v1 (two zones: question cards for uncertain rows + collapsed confident rows) was REJECTED. Zoran's ruling:

- **Spreadsheet style, LIGHT MODE**, all 20 rows visible at once. No card stacks.
- **No question system.** All fields sit directly in the grid, grouped sensibly (member / athlete / membership / payments). Uncertain values are just prefilled-or-empty cells, visually tinted, not prose questions.
- **Focus mode**, toggled by a top-right button: blurs every row except the current one. A button at the FAR LEFT of the active row completes it, which unblurs the next row and blurs the completed one. Sequential row-by-row review.
- His words: "i want it more spreadsheet style and in light mode - so i can see everyone at once... focus mode button on the top right that blurs out all rows except for the row that we're on... a button way on the left of that row to complete it... i don't like the question system lets just have all the fields there (make sure they're grouped in a way that makes sense)."

Note for the build: the earlier "confident matches collapse" ruling survives only as cell TINTING (gold = needs a look), not as collapsed rows. The complete-button state per row is workbook progress data and should persist.

**Additions during v2 review (2026-07-31):**
- Grid must hold up at ~30 rows (density tested with 10 sample rows on top of the real 20).
- **Live prices at the top of the workbook**, organized VERTICALLY BY PLAN FAMILY with the commitment terms listed under each (e.g. Academy Unlimited holds 6-months $1,399 and 3-months $749). Each term shows amount, cadence, and member count. Custom/one-off deals get their own gold card. Zoran: "i should be able to see the live prices at the top - just use lij's live prices right now" then "i want the prices organized vertically by the plan and then the commitment under it."
- **Standing instruction:** keep a complete record of the design flow because it becomes a rough skill that guides creating member workbooks for any academy. Zoran: "keep track of everything we're doing because we're probably gonna have a rough skill that can guide us through creating the member workbook."
**Prices page redesign (2026-08-01).** Zoran on the mirrored Blueprint Pricing step: "i just don't like the UI of this - it feels like it doesn't guide me through the page effectively and it feels like a bunch of fields i just have to fill out and i feel lost." 10 fixes were offered; he selected **2, 5, 6, 7, 9** and added "feel free to use colours to your advantage as well":

| # | Adopted | Meaning |
|---|---|---|
| 2 | Plain questions, not field labels | "How much do they pay, and how often?" replaces `PRICE (PRE-TAX) *`. Cadence chips read "every 4 weeks", not "Every 4 weeks / Quarterly / Other" |
| 5 | Live preview card | The parent-facing plan card sits beside the form and updates as he types |
| 6 | Commitments as a price ladder with the math | Rows show length, total, per-month equivalent, and computed saving vs the monthly base. "6 months $1,150 = $192/mo, saves $350" |
| 7 | Progress + what's left | "4 of 5 plans confirmed / 1 needs a monthly price" with a bar |
| 9 | Collapsed rows read as sentences | "$250 every 4 weeks, or pay up front for 3 or 6 months and save" replaces `Pricing type: Membership · Price (pre-tax): 250` |
| + | Colour | Per-plan-family colour spine on each card and preview, green for savings, amber for needs-attention, gold reserved for brand/CTA |

NOT adopted (offered and declined, revisit only if he raises it): 1 one-question-at-a-time, 3 drop the `↳ if type = Membership` dep badges, 4 Stripe-prefill-to-confirm phrasing, 8 essential-vs-advanced split, 10 single-card-open with auto-advance.

Build note: savings math must compare each commitment against the base price x months. Where a plan has NO base price (Academy Unlimited today), the ladder must say "set a monthly price" instead of inventing a saving, and the card carries the amber "Needs a monthly price" pill.

**What happens after a commitment (added 2026-08-01, Zoran: "in that we also have to include the 'what happens after commitment' questions as well").** The Blueprint's `after` field survives the redesign, restyled as part of the ladder rather than a separate form field. Each rung carries its own answer under the money row: "When the 3 months is up -> Goes back to monthly / Renews for the same length / Just ends." Consequences the build must keep:
- The parent-preview card states it in plain words: "When a commitment ends you go back to $250 every 4 weeks."
- Answering "goes back to monthly" on a plan with NO base price is a contradiction; the rung shows an amber "no monthly price to go back to" warning. This is the same fault the Unlimited card flags, reached from the other direction, and it is what makes the missing base price matter rather than being a cosmetic gap.
- **RESOLVED same day.** The five per-commitment fields the redesign had dropped are back at FULL Blueprint parity, visible inline, not hidden behind a "more" link. Zoran: "add all of it make sure theyre the same." Each rung now carries: editable length, price, what they get on this one, taxable yes/no, joining fee charge/waive, notes on the discount, what happens after (four options including "Something else"), and the conditional explain-in-your-own-words field when "Something else" is chosen. Only the wording changed from the Blueprint, never the field set.

**Ladder mechanics the build must preserve:**
- Commitment length is free text and the month count is PARSED from it ("6 months" -> 6, "1 year" -> 12, "12 weeks" -> 3), because the per-month and savings figures depend on it. A length with no number falls back to 1 rather than dividing by zero.
- Typing in a length or price must update only the computed figures, never re-render the ladder, or the field loses focus mid-keystroke. Chip taps can re-render freely.
- Verified against Lij's real numbers: 3 months $599 = $200/mo, saves $151. 6 months $1,150 = $192/mo, saves $350.

- **Adjust prices opens the REAL Blueprint Pricing step**, not a new editor. Zoran: "really make it match how we have it in the onboarding flow currently but adjusted to this situation." Build note: the flow already embeds the Blueprint offer wizard's Pricing step (client-portal.html, _obfWizOfferPage -> _bbRenderFromHash at step Pricing, field schema _bbStdPricing ~line 31653). The workbook's button should deep-link into that same embed prefilled with the academy's live plans; the mockup mirrors its exact anatomy (collapsible plan cards with Title / Pricing type chips / Price pre-tax / Billing cycle / Taxable / sign-up fee / Commitments slot sub-builder, Live pill per card, Archive not Remove, "+ Add pricing option", the "Bringing an existing Stripe account?" match panel into the Pricing Sorter, autosave note). Adapted-to-Lij detail: Academy Unlimited has NO base monthly price today (only 3 mo $749 and 6 mo $1,399 commitments), surfaced as a gold "No base price" pill asking him to set the return-to-monthly price or keep commitments only.

---

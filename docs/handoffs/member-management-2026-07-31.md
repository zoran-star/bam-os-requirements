# MEMBER MANAGEMENT: handoff for a cold context (2026-07-31)

**Written to be loaded into a fresh chat assuming nothing.** Supersedes nothing; this is the first handoff for this room. The room that wrote it is `MEMBER MANAGEMENT TEMPLATING`, and its whole build wave is SHIPPED.

Board file it owns: `board/rooms/member-management.json` in the orchestrator worktree (`agent-teams-access-6ba23e`). Plan file the work was tracked against: `~/.claude/plans/elegant-floating-wolf.md` (Zoran-approved; every ruling below is written into it too).

---

## WHAT THIS ROOM IS

**Skill 4, the member management system**, the last of Zoran's four onboarding skills. Scope he set: **the agreement, the enroll funnel, the onboarding automation, and the member emails**. Tied to the **training offer**, **recurring pricing only** (what GTA runs). The differentiator between member-management presets is **HOW PRICES ARE STRUCTURED** - that is the axis, and it is the thing that actually changes the machinery.

Two goals above it, unchanged: **get San Jose live**, and **build the template so academy #4, #5 and #50 onboard easily**. San Jose is not the point; it is what EXPOSES what is not templatized.

---

## ⛔ THE ONE THING THAT WILL BITE A FRESH CHAT FIRST

**Do NOT plan a migration/import path for San Jose. There is nothing to migrate, and there may never be.**

Verified by scanning Stripe directly, twice: San Jose's connected account is **brand new and empty all-time** (0 products, 0 prices, 0 customers, 0 subscriptions, 0 charges). Two different accounts, both created on the day of connection, both empty.

**The reason, established 2026-07-31 with Zoran: Lij's REAL Stripe (with his real members) is controlled by CoachIQ.** Stripe blocks `read_write` OAuth on accounts controlled by another platform (documented in Stripe's own OAuth reference: *"Starting in June 2021, Platforms using OAuth with read_write scope won't be able to connect to accounts that are controlled by another platform"*). We need `read_write` for the billing actions, so **that account cannot be connected to us, and no change on our end fixes it.**

**AWAITING LIJ (blocking nothing else):** he was asked to log into `dashboard.stripe.com` and report what he sees.
- **Full dashboard** (Payments/Customers/Products/Settings/Developers) = it is HIS Standard account. He removes CoachIQ under Settings -> Connected apps, then connects us, and **every member, card and subscription comes across**. Warn him removing CoachIQ stops their billing, so only do it when ready.
- **Stripped-down page, or he can only get in via CoachIQ** = CoachIQ owns it. It can never be connected. Members must be MOVED: Stripe can copy saved cards between accounts but only via a support request they run; otherwise every parent re-enters a card. That is a launch-date item, not an afternoon.

**Generalise it:** any academy arriving from CoachIQ, Mindbody, TeamSnap or a website builder hits the same wall. **"How do you take payments today, and did you set Stripe up yourself or through another app?" belongs on the onboarding ask-list**, asked BEFORE anyone clicks Connect. Two throwaway accounts is a cheap way to learn this; academy #6 should not repeat it.

---

## SHIPPED AND LIVE (all merged 2026-07-31, all built by one agent and adversarially tested by a different one)

| PR | What | Live state |
|---|---|---|
| #1664 | Chunk triggers imply their prerequisites - 3 instances fixed as one named shape (sales +deck, templates +prices+policy, onboarding +deck) | merged, deployed; SJ's stranded `templates: ready` reset to waiting by the orchestrator AFTER the deploy |
| #1665 | KPI ties auto-link: seeds `kpi_offer_links` per offer, catalog-basis first, refuses on conflict, never overwrites | merged |
| #1666 | Welcome email gains the manage-membership link, gated on `clients.stripe_portal_url` | merged; column APPLIED, all 47 rows NULL so it renders for nobody yet |
| #1667 | Preset apply seeds the 3 core athlete intake defs (Age only, no DOB - Zoran ruled) | merged |
| #1672 | Emergency-contact storage: a required field whose answers were being DROPPED | merged, migration applied |
| #1673 | **Portal receipt system** | merged, both migrations applied, **RECEIPTS ARE LIVE** |
| #1675 | **Billing cadence as data** - SJ can bill per 12/24 weeks, GTA byte-identical by construction | merged, migration applied (0 rows carry a cadence, so nothing bills differently yet) |
| #1676 | Stripe `account.application.deauthorized` handling | merged; **event subscribed 2026-07-31 (12 -> 13 events)** |
| #1681 | Receipt footer fix (see below) | merged, deployed |
| client-sites #176 | `/email-templates` retired, scope absorbed here | merged |

**Retired skills:** `~/.claude/skills/cancel` is now a deprecation stub pointing at the portal cancel action. ⚠️ **The old file had a LIVE Stripe restricted key pasted inline - Zoran should roll that key.** `/email-templates` retired via client-sites #176.

### Receipts, current live state
- `receipt_mode = 'recurring'` on **BAM GTA (35 live members)** and **BAM San Jose (0 members, armed and silent)**. NULL = OFF for the other 45.
- Send-once is a **unique partial index in Postgres**, not code - the double-fire webhook physically cannot write two receipts.
- Numbers **reconcile, never divide**: a real GTA receipt renders `Steady $200.00 / HST 13% $26.00 / Total $226.00`, verified by rendering with live data and sending two real test emails to Zoran.
- **GTA's `tax_registration_number` is still NULL by Zoran's choice** - receipts carry the HST line but no registration line until it is entered; it then appears on future receipts with no code change.
- `stripe_portal_url` is NULL everywhere, so the manage-membership line drops.

### ⭐ The unplanned live proof of #1676
Disconnecting San Jose's wrong Stripe account fired `account.application.deauthorized`, and the handler shipped an hour earlier **caught it by itself**: `stripe_connect_status` went `connected -> disabled`, with an audit row (`stripe-access-revoked`, event id, connected account, from/to). First real revocation that ever occurred, handled correctly. The row was then reset to `not_connected` so Lij saw a clean Connect prompt.

---

## ZORAN'S RULINGS - LOCKED, DO NOT RE-ASK

1. **7-vs-8 onboarding step CLOSED BY RULING**, his words: *"members don't need the testimonials email"*. Master stays 7 permanently; GTA keeps its 8th as a recorded GTA-only divergence. ⚠️ **The reconciler tripwire STAYS and its warning text must NOT be softened** - after this ruling there is no open workstream left to explain the gap to a future reader.
2. **Three messages are deliberately NOT built**: no parent-facing failed-payment email (staff chase with the payment link), no reschedule notice (owner messages the chat), no goodbye email on cancel. **Record their absence as loudly as a build** - comments exist in `webhook.js` at the natural spots.
3. **Receipts**: every successful payment, refunds included, self-contained email + Stripe portal link, HST/GST registration number line for tax academies, **V2-and-up only**. Footer uses the existing `FOOTER_REASON.joined` wording and carries **NO unsubscribe** (transactional; CAN-SPAM exempts them, CASL does not treat them as commercial).
4. **Enroll**: parent picks the start date; core athlete field is **AGE only, no DOB**.
5. **Cancellations are portal-only.** GTA's Sheet + Asana routine retired.
6. **Authored member emails belong to `/member-management`, hard split** (stated twice): sales never writes member emails, member management never depends on sales having run.
7. **Strategy**: **San Jose in bits -> learn -> write the skill LAST.** Do not write the skill against what was planned; write it against what actually shipped.
8. **Bugs become SUBAGENTS, never suggested-task chips** (standing team rule). The collision check moves EARLIER, to the moment of spawning, answered **by content and never by title**. If you cannot answer it, the finding goes to the orchestrator instead of becoming an agent.

---

## THE STRIPE DESIGN, AGREED WITH ZORAN 2026-07-31 (next build phase)

His goal, verbatim: *"have the client click to connect stripe, and then we can price match, contact match, and do everything else here on our end and have the client operate in the portal, without clicking stripe sync up"*.

**Orchestrator finding that reframes it: NONE of the five onboarding skills mentions Stripe.** This work is not in the wrong skill, it is in NO skill - it exists only as buttons staff must know to press.

**THREE matches, not two** (Zoran's question "what about matching contacts to stripe prices?" produced this):

| | What | Trigger | Status |
|---|---|---|---|
| **Match 1** | Stripe customers <-> our contacts | **automatic on connect** | specced, NOT built. Locked rules from `api/contacts/stripe-link.js`: staff-side, exact-email single match auto-links silently, no match mints a contact (`source='stripe-import'`), duplicates go to the merge tool. MUST be a **resumable job** - the sweep is paged (5x100/call, maxDuration 60) and contacts usually arrive AFTER Stripe connects |
| **Match 2** | our plans <-> Stripe prices | **a Claude SKILL**, tested by hand on San Jose first | Zoran changed this from automatic: real Stripe accounts are messy, it needs judgement about live vs legacy prices using clues like how many people are on each. Must be able to CREATE a product/price when nothing matches nicely |
| **Match 3** | person + plan = a member row | the member seeding process | **DO NOT BUILD A SKILL YET.** Test with Lij in San Jose first, then write the skill from what it teaches |

**Match 3 is the one that matters**: it is what makes pause, cancel, refund, change-plan and receipts work at all. GTA proves the shape - 46 of 47 members carry `contact_id` + `stripe_customer_id` + `stripe_subscription_id` + `stripe_price_id` on one row. Match 1 alone knows the person but not what they pay; match 2 alone knows the plan but not who is on it.

⚠️ **Match 1 has NOTHING to chew on at San Jose** (0 Stripe customers). It is really a MIGRATION tool - when a parent enrolls through the funnel, the Stripe customer and the contact are created in the same breath, born linked. Match 1 only earns its keep at an academy that had Stripe customers BEFORE the portal.

### The Excel round-trip is DELETED, replaced by a WEB WORKBOOK
Zoran's words: *"create a website that is kinda like a workbook where we give our proposals and then they can edit it"*. Rulings: **private shareable link** (no login) · **staff confirms before anything applies** · **one-time setup only** (the Members tab is the ongoing surface). Design: confident matches collapse, only the handful needing a human are read; owner answers in plain terms; their answers become a proposed change list.

### The webhook subscription belongs to NOBODY
One platform-wide setting for all 47 academies. **Zoran ruled: one manual run now (DONE - 13 events, verified) PLUS automatic on connect** so the list can never fall behind again. It being a button someone had to know about is exactly why #1676's handler sat unreachable.

---

## PRODUCTION FACTS VERIFIED 2026-07-31 (one corrects an earlier brief)

**12 academies are Stripe-connected. Only THREE are V2:**

| Academy | Stripe subs | Portal members | Meaning |
|---|---|---|---|
| BAM GTA | 24 active | 47 (46 fully wired) | the reference shape |
| BAM San Jose | 0 | 0 | clean slate, see the CoachIQ blocker above |
| **DETAIL Miami** | **21 active** | **0** | **the only real migration case. PARKED by Zoran** |

The other 9 are V1.5 holding **~230 live subscriptions between them** (Basketball+ 100+, CH3 51, Prime By Design 49, Sage Hoops 6, Fitz N Fit 4, Elevate 2, Hoops Made Simple 2). Correct-by-design today since they run on GHL, **but each becomes a migration the day it moves to V2.** So "no backfill problem, only a first-run problem" is true for V2 minus Miami, with a real latent scale problem behind it.

---

## QUEUE ITEMS THIS ROOM SURFACED AND DID NOT BUILD

1. **The sorter UI mis-states cadence** - `client-portal.html` renders it from the term, so a price minted on a 12-week clock shows to the owner as "every 3 months". The mint is right and the screen is wrong, which is the more dangerous direction. The API response now carries `billing_cadence`/`recurring` for a consumer to use.
2. **Nothing writes `offer_prices.billing_cadence`** - no UI or endpoint sets it, so SJ's rows need hand-written SQL until one exists.
3. **`webhook.js` reverts commitments on the TERM, not the cadence** - `metadata[billing_cadence]` is stamped but the `from_subscription` phase length still reads the term. Becomes real at SJ's first 3-month member.
4. **Receipts for the reconcile-cron activation path** - `reconcile-activations.js` calls `activatePortalOnboardingMember` directly and issues no receipt for a webhook that never arrived.
5. **A member with no `parent_email` gets no receipt row at all** (skipped before insert), so there is no record of that payment.
6. **Receipt-number race** documented in code, not fixed: two payments at one academy in the same instant can share a number. The unique index guarantees no duplicate receipt, not unique numbering.
7. **`athlete_age` is storable but unspeakable** - no `{{contact.athlete_age}}` in `resolveMergeVars`, so no master body can mention an athlete's age. The core-token guard prints this on every green run.
8. **`scripts/apply-preset.mjs` bypasses the endpoint** and does not seed core fields (staff-only path).
9. **13 GTA members' emergency contacts are recoverable** from `member_audit_log`; 9 have a contact to write to, 4 do not. `scripts/recover-emergency-contacts.mjs` is REPORT-ONLY and writes nothing without `--write`. **Which families to recover is Zoran's decision, untaken.**
10. **Owner-facing controls for `receipt_mode` / `tax_registration_number`** do not exist - both are SQL-only today.
11. **Cadence vocabulary lives in three parity-tested copies**; a shared `api/_cadence.js` would be cleaner (SCALE).
12. **The `/cancel` skill's live Stripe key should be rolled** (see Retired skills above).

---

## HOW THIS ROOM WORKED, AND WHY IT IS WORTH COPYING

Every build: **one builder agent, then a DIFFERENT agent attacking it adversarially**, bouncing until clean, then PR with the tester's verdict in the body. **15 real defects were caught before anything shipped**, including a table shipped without RLS (parent payment data behind a browser anon key), a signup fee that could have been minted as a monthly subscription, a suite that would have passed while the feature was unwired, and a safety-net test pinned to its own net never being used.

The pattern in the bounces is consistent and worth carrying: **the logic kept surviving; what kept getting caught was SILENCE** - failures nobody would hear about, caps that did not announce themselves, confirmations that reported success without providing it. That is `memories/reference_assurance_without_connection.md` arriving over and over.

**House rules that earned their keep here:** verify a claim before acting on it (four production reads killed four scary-sounding claims); trace overrides rather than grep literals; say what you did not verify; a committed test with a negative control that PRINTS when it is caught; and **watch the deploy** - `bam-portal` took 11.5 minutes on one merge, and acting on data before it landed would have re-broken the thing just fixed.

---

## WHAT A FRESH CHAT SHOULD DO FIRST

1. **Read the board file and this doc, then check `docs/lij-onboarding-build-queue.md`** in the orchestrator worktree for anything that moved after 2026-07-31.
2. **Do not start the skill.** Zoran ruled it last, written against what shipped.
3. **The next buildable thing is match 1** (contact matching, automatic on connect) plus **webhook-ensure on connect**. Both fire on the same event, neither needs judgement, and both are fully specced above. Match 1 will do nothing at San Jose and that is expected.
4. **Match 2 is a hands-on run with Zoran for San Jose** (mint his prices from the typed offer), then write the skill from it. That is real launch progress and the skill's raw material in one pass.
5. **Wait on Lij** for the CoachIQ answer before planning anything member-import shaped.

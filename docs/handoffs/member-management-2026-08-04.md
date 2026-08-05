# Member management: San Jose handoff, 2026-08-04

Written cold for the next chat. Assumes nothing.

---

## THE HEADLINE: LIJ IS CONNECTED. Verified in production, not assumed.

| Fact | Value |
|---|---|
| Academy | BAM San Jose, `client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154` |
| Owner | "Lij" (Elijah), business **3D Basketball Prep**, elijah@3dsportsprep.com |
| Stripe account | **`acct_1RDtSMK6ZS1cqefu`** - his REAL one, not a throwaway |
| `stripe_connect_status` | **connected** (2026-08-04 21:20 UTC) |
| Key stored | encrypted in `client_stripe_direct`, livemode, last4 `xGAh`, status `active` |
| Charges enabled | true |
| Academy webhook | **`we_1U0plLK6ZS1cqefuq3AhFVOo`, enabled, 12 events, livemode** - confirmed by querying Stripe directly, not by trusting our own success response |
| His book | **20 live subscriptions, ~$4,640/month, 147 customers, 119 prices (13-14 in use)** |

**How he got connected, since it is not the normal path:** his Stripe is platform-locked by CoachIQ, so Stripe blocks read_write OAuth forever. We built a SECOND TRANSPORT: the portal stores his own restricted API key (encrypted) and one resolver routes every existing Stripe call to it. Nothing downstream knows which transport an academy uses.

---

## ⚠️ THE ONE THING NOT YET PROVEN, and it is a bug in our own code

The final step asks PRODUCTION to decrypt the stored key and prove it can use it. It returned:

```
{"checked":1,"ok":0,"invalid":0,"unreachable":1,
 "results":[{"client_id":"5576acf0-...","outcome":"unreachable",
 "error":"the Supabase service key contains a line break or non-printable character"}]}
```

**That is our own shape-check being too strict, not a broken key.** Production's `SUPABASE_SERVICE_KEY` carries a trailing newline (known repo hazard: use `printf`, never `echo`, when piping into `vercel env add`). The check refuses ANY key with a non-printable char - correct for a pasted key, wrong for our own env config.

**Fix in flight when this doc was written:** trim first, then refuse. Trailing whitespace is a cosmetic artifact and gets trimmed; a break REMAINING INSIDE after trimming is the leak vector and is still refused. Builder `builder-trim` was running against `api/_stripe-transport.js`.

**RE-RUN THE PROOF once that lands:**
```
curl -s -X POST -H "Authorization: Bearer <CRON_SECRET>" \
  https://portal.byanymeansbusiness.com/api/stripe/cron-key-health
```
Expect `ok:1` for client `5576acf0`. Anything else, read the `error` field before concluding.

**This does NOT affect his stored key or webhook.** Both verified independently against Stripe.

---

## WHAT SHIPPED TO PRODUCTION TODAY

| PR | What |
|---|---|
| #1703 | The direct-key transport: resolver, encrypted key storage, staff panel, per-academy webhook registration |
| #1704 | Contact refresh CLI + a **live bug fix**: `bulkUpsertPortalContacts` silently dropped mixed-key batches (PGRST102), which was losing contacts for every V1.5 academy |
| #1705 | CI regression fix (`hour12` -> `hourCycle`) that was failing every PR in the repo |
| #1718 | **SECURITY**: key-leak fix + `saveDirectKey` extraction + one-account-one-academy guard |

Migration `20260801T120000_client_stripe_direct.sql` **applied and read-back verified**: two RLS-locked tables, `client_stripe_direct` + `stripe_academy_webhooks`.

Env set in Vercel **production only**: `STRIPE_DIRECT_ENC_KEY`, `PORTAL_BASE_URL`. Preview adds failed on a CLI wrapper loop; preview deploys refuse webhook registration anyway via the PORTAL_BASE_URL guard.

---

## 🔴 THE SECURITY BUG, because the lesson matters more than the fix

A Stripe key pasted **with a line break in it** (the normal result of copying out of a wrapped email, Slack, or a PDF) survived `.trim()`, reached `fetch`, and undici threw with **the entire header value in the message**. Statusless, so `direct-key.js`'s catch echoed it into the HTTP response body. **The staff panel returned a live key to the browser.**

Three things worth carrying:
1. **A regex scrub would NOT have worked.** The newline splits the key, the pattern stops at the break, the tail stays on screen. Test canaries are TWO-PART for exactly this reason.
2. **The trigger is not theoretical.** Zoran's own `.env.local` stores 24 values with a literal `\n` inside the quotes. And production's Supabase key has one, which is what just bit the proof step.
3. **The file's existing no-leak claim was FALSE.** Its header promised the key never appears in any error and cited a probe. That probe only covered errors we CONSTRUCT, never ones the runtime THROWS. The claim was broader than the test, so it read true while being false. **The claim and the probe were fixed together.**

---

## THE OPERATING MODEL THAT PRODUCED THIS - do not drop it

**Every build made by one agent, adversarially attacked by a different one. 11 defects caught, 0 shipped.** A sample, to show what the testers actually caught:

- A probe recorded "could not reach Stripe" as "permission absent, forever"
- A health read could silently re-arm a key staff had disabled
- A database blip during a real Stripe revocation dropped the event permanently (200-ack, Stripe never retries)
- A checkout return could 500 **after** the payment was created
- The two-id invariant was CORRECT but **undefended** - the test compared them to each other, so swapping both at once passed 56/56

**Negative controls must PRINT when they catch.** A silent non-zero exit does not count. 26 controls in the Stripe suites, all printing.

---

## ⛔ THREE CORRECTIONS THE ROOMS MADE TO ME, and the rule that came out

Three times I described something as established that had never happened: two question lists I said I had read, and an agreement between two rooms that never existed. **Every catch was a room's, not mine.**

**RULE: an orchestrator repeating something back to a room is not evidence it exists.** Rooms must correct it flatly, without softening, and this one did.

---

## WHERE EVERY WORKSTREAM STANDS

### DONE
- **Contacts**: 147/147 of his Stripe customers resolved. **142 linked, 5 skipped** (all duplicate Stripe customers of an already-linked person), **0 pending**. 559 contacts in his store. Zoran supervised every review decision. Done OFFLINE before the transport shipped, which collapsed transport day into a verification pass.
- **Prices decided**: 4 plans (1x/week 175-425-875, 2x/week 250-599-1150, Unlimited 300-749-1399, Elementary 200), **$40 signup fee on the 4-week option only, waived on prepay**. 13 of 14 in-use prices ruled live-or-legacy, 19 of 20 members covered. **Two DB writes are already in production**: the fee on the live SJ offer, and the Elementary plan.

### BUILT, NOT APPROVED
- **Price workbook mockup**: `docs/plans/sj-price-workbook-mockup-v1.html`. 9 cards, full field parity, academy-level tax card, confirm mechanic. **Zoran was asked to gate it four times and never answered** - he inspected it instead and found a dead tax control, which he ruled should become a real question ("Make it real: ask his tax rate"). **THIS IS THE #1 BLOCKER.**
- **Member workbook design**: `docs/plans/lij-workbook-mockup-v2.html` + `docs/plans/lij-workbook-decisions.md`. Grid **LOCKED by Zoran** ("Locked, build it"). **Zero code written** - cleanly nothing to untangle.

### NOT STARTED
- Building either workbook for real
- Seeding his 20 members
- The three skills

---

## ZORAN'S RULINGS, VERBATIM WHERE RECORDED

| # | Ruling |
|---|---|
| Skills | **THREE SEPARATE skills**, living in `bam-client-sites/.claude/commands` next to the five onboarding skills. Each refuses to run until its trigger is true, checked against real DB state |
| Skill 1 · match | contacts sync -> price pull -> first draft -> match to Stripe -> price workbook (5 steps, staff confirms each) |
| Skill 2 | finalize prices -> members workbook |
| Skill 3 | per-member pass: seed + action items + workbook task, **one confirm per member** |
| Chain rule | consecutive orange = one skill; only a client action or a trigger cuts a chain |
| Skills written LAST | from the real San Jose run logs, never from a plan |
| Seeding | *"we dont do seeding in this chat because we have to wait for lij so just leave it for the orchestrator chat todo"* - so seeding belongs to THIS chat, and the separate seed-cockpit chat was cancelled |
| "Not a member" | *"stop chargin this parent"* - **this is a MONEY PATH, not a skipped row** |
| Editing money | *"only plan and date"* - prices change ONLY through the price surface, never per member |
| Two athletes, one subscription | *"yes"* |
| Partial submit | *"every row has to be confirmed, so put guardrails in the UI"* - **no partial submit, binds BOTH workbooks** |
| No-login link | *"fine for now, we will change it in teh future"* - **an accepted risk with a date, not a permanent design** |
| Tax | *"Make it real: ask his tax rate"* - academy-level card, not per plan |
| Lij's experience | **exactly TWO links, nothing else.** Every stray question folds in as a row he answers in place |

---

## CARRIED RULINGS I MADE (challenge them if wrong)

- **Academy-level answers are their own kind in the capture schema**, never flattened into price rows. A wrong price row costs one plan; a wrong tax rate re-prices every athlete. They surface FIRST in staff review.
- **The stop-billing queue is owned by this chat**: rows carry dollar amount, subscription id, parent name, date flagged. **Working the queue is a REQUIRED step in skill 3**, not optional cleanup. Every day one sits unactioned is a family paying for a child who quit.
- **Both workbooks are LIGHT themed** - one product family for Lij.
- **The Aug 5-7 renewals** (Ted $200, Jimmy $250, Jenny $200) are **accepted as untracked**. Stripe charges normally, receipts off, webhook handlers audit-and-skip unknown invoices by design, and seeding afterwards captures the cleaner post-renewal state. This has an owner; it is not a gap.
- **The capture schema is a PROPOSAL**, not an agreement. The two rooms never agreed one; the member workbook chat designed it alone. Its intent is the part to defend: *a consuming agent reads DECISIONS not values, and an unread row must not serialize identically to an approved one.*

---

## OPEN QUESTIONS FOR ZORAN

1. **Gate the price workbook** - approve or name a change. Asked 4 times, never answered. **Everything price-side is frozen on it.**
2. Which plan is "Academy (Christopher)" $199/4wk a deal on? (needs Lij - folds into the workbook as a row)
3. Elementary got the $40 fee by default - keep or drop?
4. Lij's Stripe shows a **NOSETUP waiver used 3 times** - does he use discount codes, should the workbook arrive with it prefilled?
5. Summer Bundle Camp ($250-350) and Tryouts ($30) are sold as one-time charges outside subscriptions. In or out of scope?
6. Should commitments become archivable in the real wizard? Today removing a rung 5 families pay on is a hard delete.
7. **Portal-created vs portal-linked subscriptions** - what does created buy over linked? The portal already cancels/pauses/refunds linked subs. If ruled in: create-first, cancel-at-period-end, never a gap.

---

## TRAPS THAT WILL BITE YOU

1. **`vercel env pull` values carry literal `\n`.** 26 in the prod file, 24 in `.env.local`. **Never `source` these files** - parse them and strip. This is what broke the first save attempt and what is currently blocking the proof step.
2. **The env var is `SUPABASE_SERVICE_KEY`**, not `SUPABASE_SERVICE_ROLE_KEY`. The latter is ABSENT in production. The code reads `ROLE_KEY || KEY`, so it works, but a script that only reads ROLE_KEY gets nothing.
3. **`PORTAL_BASE_URL` is never validated as production.** Point it at a preview and a webhook registers against the preview. Only a human catches it.
4. **`cron-key-health` has no per-academy scope.** It probes EVERY direct-key academy per call and stamps `key_last_verified_at` on each. Fine at one academy, wrong at twenty. **Queued as a real item.**
5. **GitHub push protection blocks key-shaped test fixtures.** A room hit this. **Never resolve it by allowlisting the secret** - rebuild the fixture from parts.
6. **The one-doorway scan** (`api/_stripe-transport-parity.test.mjs`) means `client_stripe_direct` and `stripe_academy_webhooks` may appear in only 6 allowlisted files. `scripts/` is NOT scanned - keep the table names out of scripts entirely rather than creating an unaudited hole.
7. **The staff panel has never touched real Stripe.** Today's save went through `saveDirectKey` directly, bypassing it.
8. **The chat CLI is unproven.** Built at `scripts/save-direct-key.mjs` on branch `claude/keen-banach-69618e`, 93 self-written assertions, but **its adversarial tester was stopped before reporting.** Treat as unverified. Its v1 FAILED by leaking a live key.

---

## KEY FILES

| Path | What |
|---|---|
| `api/_stripe-transport.js` | **THE resolver.** The only file that knows a second transport exists |
| `api/stripe/direct-key.js` | staff key entry: probe / save / disable / status. Exports `probeKey`, `saveDirectKey` |
| `api/stripe/ensure-academy-webhook.js` | per-academy webhook registration, crash-safe |
| `api/stripe/cron-key-health.js` | hourly three-outcome key probe |
| `api/_stripe-transport-parity.test.mjs` | byte parity + the one-doorway scan (372 files) |
| `scripts/stripe-transport-inventory.txt` | 37 reasoned verdicts; an unlisted Stripe reference fails the build |
| `docs/plans/sj-price-match-log.md` | every price ruling in Zoran's words + the field map |
| `docs/plans/lij-workbook-decisions.md` | the six rulings + capture schema proposal |
| `docs/plans/sj-contact-linkup-learnings.md` | contact matching field report (branch `claude/keen-banach-69618e`) |
| `docs/workbook/sj-roster-2026-07-31.json` | his real 20 subscriptions |
| `docs/workbook/sj-stripe-customers-2026-08-01.json` | all 147 customers |
| `docs/plans/chat-scope-map.html` | the mission control page |

---

## HOW TO TALK TO ZORAN

ADHD, visual learner, hates reading. **Short and visual: tables, bullets, bold the key thing, ONE clear next action.** Mockups he can accept or reject in under two minutes, never specs. Question popups rather than paragraphs. **Never an em dash anywhere in person-facing output.** Do not offer to pause. **End every message with a two-line fun fact about Serbia not used before in that conversation.** He questions premises and is usually right to - the CoachIQ read-only challenge and the dead tax control were both his. When wrong, say so in one sentence and move on.

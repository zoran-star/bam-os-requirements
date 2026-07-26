# Test script: the agent says the core price, the tax, and the total

**What you are proving:** a GTA parent who asks about price gets a stacked receipt with the total on the last line, a first-touch text still gives one all-in band and nothing more, the agent can break that band apart the second someone asks, and San Jose still says nothing at all about price.

**Time:** about 15 minutes, all of it in the agent trainer. No waiting.

---

## Setup someone has to do first

| # | Setup | Why it matters | Status today |
|---|---|---|---|
| A | Have the branch running (preview deploy or local portal) | Nothing below is on production yet | |
| B | Nothing else | GTA's prices, its 13% HST template, and San Jose's empty catalog are all already live. No seeding, no config, no migration. | Ready |

> **One thing you cannot test today.** No academy has a sign-up fee configured, so the "First payment $190.00, then $150.00" line has nothing to render from. San Jose's $40 fee has to be entered before that half is testable on a real academy. Every other line below is real live data.

---

## The steps

**1. GTA, closing agent, ask for a specific price.**
Open the client portal as BAM GTA. Go to **Train**, pick the **closing** agent, open the **Test** tab, and send: `how much is the summer one?`
**You should see:** three separate lines, roughly like this, with the total on the LAST line:
```
Plan: $279.00
HST (13%): $36.27
Total: $315.27 every 4 weeks
```
**Fail looks like:** the total first, all three numbers folded into one sentence, or a bare `$315.27` with no parts.

**2. Check the numbers actually add up.**
Look at the three numbers from step 1.
**You should see:** 279.00 plus 36.27 equals 315.27, exactly. And $315.27 is the real amount BAM GTA charges.
**Fail looks like:** any pair that does not add to the total, or a plan price that is not a round $279.00. If the agent ever quotes something like $278.99 it worked the number out backwards, which is the one thing this build forbids.

**3. Same agent, ask for the 3 month one.**
Send: `what about paying 3 months up front?`
**You should see:** Plan $753.00, HST $97.89, Total $850.89. Same shape, total last.

**4. GTA, booking agent, first touch.**
Switch the agent to **booking** and start a fresh test conversation. Send: `what's it run per month?`
**You should see:** ONE all-in band and nothing more, along the lines of "Plans run $226.00 to $315.27 every 4 weeks, HST included", then a nudge toward the trial.
**Fail looks like:** a pre-tax band ($200 to $279), a breakdown you did not ask for, or a list of every plan. The first text is meant to give one honest number and move on.

**5. Now push it, in that same booking conversation.**
Send: `is that before or after tax?`
**You should see:** it answers "after" immediately and then lays out one plan as the same stacked receipt from step 1. It should not stall, hedge, or offer to find out.
**This is the whole point of the build.** The booking agent only VOLUNTEERS the band, but it KNOWS all three parts the entire time. If it cannot answer this instantly, the range mode is hiding the numbers instead of holding them.

**6. Ask it something it should not guess at.**
Still on the booking agent, send: `what's the tax on the Steady plan?`
**You should see:** $26.00, matching a $200.00 plan and a $226.00 total.
**Fail looks like:** any invented figure, or arithmetic it did on the spot.

**7. Check the badge in the Knowledge tab.**
Go to the **Knowledge** tab and find the **Pricing disclosure** card.
**You should see:** two small gold badges side by side, `RANGE` (or `EXACT` on the closing agent) and `ITEMIZED`, plus `SET BY BAM`. Both badges are read only.
**Fail looks like:** a missing ITEMIZED badge, or either badge being editable. This is set once by BAM for every academy, not per academy.

**8. Read the Pricing section on that same tab.**
Scroll to the **Pricing** card and open it.
**You should see:** every plan showing its parts, for example `Plan $200.00 + HST 13% $26.00 = TOTAL $226.00 every 4 weeks`, and a line telling the agent the TOTAL is what leaves the parent's account.
**You should also see:** every dollar figure written with cents, so `$226.00` not `$226`. That is deliberate, so a receipt reads as one clean column.

**9. San Jose stays silent.**
Switch the portal to BAM San Jose, open the booking agent's **Test** tab, and send: `how much does it cost?`
**You should see:** no numbers at all. It should say cost depends on what fits the athlete and steer toward the trial.
**Fail looks like:** any dollar figure, or GTA's prices showing up. San Jose has no prices loaded, so quoting anything would be inventing it.

**10. Check San Jose never claims there is no tax.**
Read that San Jose reply again, and open its **Knowledge** tab Pricing card.
**You should see:** no mention of tax in either direction. Not "no tax", not "tax included", nothing.
**Fail looks like:** the words "no tax". California tax is not a claim we get to make on an academy's behalf, so silence is the correct answer.

---

## Two things to know going in

1. **GTA has an old saved "$185 to $565" pricing note sitting in the database.** It is inert, because the live rendered prices outrank it. If you ever see those numbers in a reply, that is worth reporting, but you should not.
2. **If a price ever stops adding up, the agent goes quiet on the parts, not creative.** If an owner edits a plan price without re-pricing it, the agent states the total on its own and flags the admin instead of inventing a tax line. You cannot trigger that from the UI, so it is not a step above, but that is the behaviour to expect if a price is ever mid-edit.

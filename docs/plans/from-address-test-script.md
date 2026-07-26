# Test script: every academy sends as itself

**What you are proving:** San Jose emails go out as BAM San Jose, no sending domain means the email waits instead of going out as BAM Toronto, and GTA parents notice zero difference.

**Time:** about 20 minutes of clicking, plus one wait of up to an hour at step 8.

---

## Setup someone has to do first

| # | Setup | Why it matters | Status today |
|---|---|---|---|
| A | In Resend, add `byanymeanssanjose.com` and finish the DNS records until it reads **Verified** | A domain that is added but not verified still holds. Verified is the switch. | Not done |
| B | Put a mobile number on BAM San Jose's **owner** user in the portal (Settings > Team), or set `onboarding_setup.owner_phone` | **Without this the hold text goes nowhere and the hold is silent.** San Jose's owner has no phone on file right now. | Not done, blocks step 6 |
| C | A test lead in BAM San Jose with an email inbox you can actually open | You need to see what does and does not arrive | |
| D | Leave BAM San Jose's `email_domain` **empty** until step 7 | Steps 4 to 6 test the hold. Setting it early skips the whole point. | |

> The worker runs every minute, so new emails hold within about a minute. Emails that are **already** held recheck once an hour. That is why step 8 has a wait.

---

## The steps

**1. GTA first, because this is the one that would be embarrassing.**
Open the client portal as BAM GTA. Go to **Train > Automations**, pick any live email step, and send it to your own address (use a test lead with your email).
**You should see:** an email lands in your inbox. Open the sender details. The From line reads exactly `BAM Toronto <info@byanymeanstoronto.ca>`.
**Fail looks like:** `BAM GTA <...>`, or any change at all to that line.

**2. Confirm GTA had nothing held.**
Ask an engineer to show you the automation jobs for BAM GTA from the last hour.
**You should see:** the job you just triggered says `sent`. Nothing says `held`.

**3. Switch to BAM San Jose and confirm the domain is still empty.**
In the staff portal, open BAM San Jose's settings and check the sending domain field is blank.
**You should see:** no sending domain set.

**4. Trigger a San Jose email and then wait two minutes.**
Enrol your test lead in a San Jose automation whose first step is an email. Wait two full minutes, then open the test inbox.
**You should see:** nothing. An empty inbox.
**Fail looks like:** any email arriving, and especially one from BAM Toronto. That is the exact leak this build exists to stop.

**5. Check the job actually parked instead of dying.**
Ask an engineer for that job row.
**You should see:** status `pending`, last error `held: sending domain not set`, attempts `0`.
**Fail looks like:** status `failed`, status `skipped`, or attempts counting up. A hold must never burn a retry.

**6. Check the owner's phone for the heads up text.**
**You should see:** exactly one text: "Heads up: your automation emails are on hold because your academy's sending domain is not set up yet. Ping BAM staff to finish email setup, then held emails go out on their own."
Now wait ten more minutes and check again.
**You should see:** no second text. One text per academy per day, no matter how many emails are waiting.
**If no text arrived at all:** setup item B was skipped. The email still held correctly, but nobody was told.

**7. Flip the switch.**
Set BAM San Jose's `email_domain` to `byanymeanssanjose.com` (Resend must already show it Verified from setup item A).

**8. Wait up to one hour, then check the test inbox.**
**You should see:** the email from step 4 arrives on its own, no re-triggering. The From line reads `BAM San Jose <info@byanymeanssanjose.com>`.
**You should also see:** the job row now says `sent`. Ignore the old "held" text still sitting in its last error field, that is cosmetic and the send is real.
**Fail looks like:** still nothing after an hour, or an email from BAM Toronto.

**9. Re-check GTA one more time, after the San Jose change.**
Repeat step 1.
**You should see:** the same exact From line, `BAM Toronto <info@byanymeanstoronto.ca>`. San Jose going live changes nothing for Toronto.

**10. Prove texts were never affected.**
Pick a San Jose automation step that is **SMS**, not email, and trigger it while everything else is running.
**You should see:** the text arrives normally, same as always. None of this touches SMS.

---

## Two things to know going in

1. **Trial confirmation emails do not queue.** If a San Jose parent books a trial while the domain is unset, the confirmation **text** still sends but the confirmation **email** is skipped for good, not held. Only the drip and nurture emails wait and release. Worth setting the domain before San Jose takes real bookings.
2. **A held email is patient, not stuck.** It sits as `pending` for as long as it takes. The only signals a human gets are the once a day text from step 6 and the engineer-side job list. If nobody has a phone on file, nobody finds out.

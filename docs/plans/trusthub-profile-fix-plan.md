# TrustHub Primary Profile: fix plan

**Decided 2026-07-26** in a planning room with Zoran. Unblocks the Scenario A model
(BAM master account + one subaccount per academy) for every academy except San Jose.

Companion doc: [`sj-phone-twilio-plan.md`](sj-phone-twilio-plan.md) (branch `claude/upbeat-cohen-0b99f7`),
which decided San Jose runs on Lij's own Twilio account and is NOT waiting on this.

---

## TL;DR

| | |
|---|---|
| **Decision** | Abandon the rejected profile. Stand up a **new Twilio master account under FullControl**, which is a registered entity with its own EIN. |
| **Why a new account is cheap** | `TWILIO_PRIMARY_PROFILE_SID` was never set, so the A2P chain has never run once. Zero brands, zero campaigns, zero numbers to lose. Only 3 env vars point at the old master. |
| **Why a new account is NOT the fix** | A new account does not change EIN verification. Same legal name plus EIN in a fresh account produces the same 18602 rejection. The fix is filing under FullControl's own correct details. |
| **Main risk** | FullControl's EIN is roughly 2 to 3 months old. Twilio documents a **30 to 90 day propagation window** for new EINs. We are inside it. |
| **Recommended submit date** | **Thursday 2026-07-30** |
| **Expected done** | Best case 2026-08-01. Realistic worst case **2026-08-12** via manual verification. |
| **Urgency** | Nothing is blocked. Every academy can run texting and calling on GHL LC Phone transport inside the portal inbox in the meantime. This is a de-risking project, not a rescue. |

---

## The problem, stated correctly

Profile `BU3557...f0bd`, friendly name "FullControl", has been `twilio-rejected` since 2026-07-06
with **error 18602: "The Business ID you provided could not be verified."**

Root cause: it was submitted with the OLDER entity's details, so the EIN and legal name pair did not
match government records. A 2026-07-03 note said "use the older entity, swap to the new corp later."
That deferred swap is the blocker.

Why it is a hard gate: Twilio requires a `twilio-approved` **Primary** Business Profile before any
**Secondary** Customer Profile can exist. No secondary profile means no client brand and no client
campaign. [`api/twilio/register-a2p.js`](../../bam-ghl-agent/bam-portal/api/twilio/register-a2p.js)
is env-gated on `TWILIO_PRIMARY_PROFILE_SID` and fails cleanly at stage 1 until this clears.

---

## Decisions

### 1. New Twilio master account, under FullControl

Zoran's call. Two reasons it is right:

- **Correct identity.** FullControl is the software product that resells messaging to academies.
  That is textbook **ISV / Reseller / Partner**, which is a business-identity option on the profile.
  BAM the basketball academy is a *customer* of that model, not the filer.
- **It is nearly free right now.** Nothing is live on Twilio. Switching later, after brands and
  campaigns exist, would be expensive because A2P registration never transfers between accounts.

**Explicitly recorded so nobody re-litigates it:** a new account does not dodge error 18602.
The rejection is a records lookup on the EIN and legal name, not an account-level flag. The new
account is worth doing for architecture, and the entity correction is what actually fixes the error.
Both are happening at once.

### 2. File as FullControl, not the older entity

FullControl is a registered legal entity with its own EIN (confirmed by Zoran, 2026-07-26).
This gives one consistent story across all three things Twilio cross-checks:

| Field | Value |
|---|---|
| Legal business name | FullControl's registered name, **exactly as printed on the CP 575** |
| Website domain | FullControl's own domain |
| Authorized rep email | On that same FullControl domain |

The old rejected profile and the old master account are abandoned, not repaired.

### 3. Submit immediately, do not wait for the EIN to age

This is counterintuitive so here is the reasoning.

The EIN is inside the 30 to 90 day propagation window, so a straight submit may fail. The instinct is
to wait a month. **Do not.** A rejection costs nothing and is the required first step of the fallback:

- No fee to submit or resubmit
- No documented resubmission limit
- Nothing to upload
- You edit and resubmit the same profile
- Review is up to 48 hours

And critically: **Twilio support needs a failed submission to act on before they will manually verify
against the CP 575.** So the "wasted" attempt is not wasted. It is the ticket that opens the manual path.

Waiting 30 days has a real cost and no benefit.

### 4. Privacy Policy and Terms are NOT needed for this submission

The 2026-06-30 rule requiring live Privacy Policy and Terms URLs applies at **campaign registration**,
which is downstream and per-academy. The Primary Business Profile needs a **live website** only.

This shortens the critical path a lot. Build the legal pages alongside the site because you will need
them for every academy campaign later, but they do not gate Thursday.

---

## Timing

Today is Sunday 2026-07-26.

```
 Mon 07-27   Zoran: pull CP 575. Confirm exact legal name, EIN, address.
             Zoran: set up rep email on the FullControl domain.
 Mon - Wed   Build: FullControl site live. Not parked, not login-gated,
             names the legal entity somewhere visible.
 Thu 07-30   Zoran: create Twilio account, fill Primary Profile, SUBMIT.
             │
             ├── approved within 48h ──► Sat 08-01  DONE, gate E opens
             │
             └── 18602 again ──► Mon 08-03  open Twilio Support ticket,
                                 attach CP 575, reference the profile SID
                                 │
                                 └── 5 to 7 business days
                                     ──► ~Wed 08-12  DONE
```

**The EIN-age branch in one line:** an EIN over 90 days old takes the top path, an EIN under 90 days
usually takes the bottom path. FullControl's is right on the boundary, so plan for the bottom path
and be pleasantly surprised by the top one.

**The real long pole is the website, not Twilio.** Zoran said it can go up quickly. If it slips, the
submit date slips with it, because the profile requires a reachable URL at submission time.

---

## Ready-to-submit field checklist

Everything below is copy-and-paste off the CP 575, character for character. Do not retype from memory
and do not use a W2 or W9, whose name formatting often differs from the CP 575.

### Gate A: legal identity (Zoran)

| # | Item | Rule |
|---|---|---|
| A1 | CP 575 letter in hand | If lost, request a **147C** replacement from the IRS by phone. Adds lead time. |
| A2 | Legal business name | Exactly as on the CP 575. Character for character, including suffixes like INC or LLC. |
| A3 | EIN | Formatted `00-0000000`, dashes included. **Never a DUNS number** for a US entity. |
| A4 | Business type | Corporation / LLC / Partnership / Non-profit, matching the registration. |
| A5 | Physical address | Matches tax records. **No PO box.** |
| A6 | EIN issue date noted | Drives which timeline branch you are on. |

### Gate B: web presence (build)

| # | Item | Rule |
|---|---|---|
| B1 | Live FullControl site | Reachable, not parked, not login-gated, no redirect to an unrelated domain. |
| B2 | Legal entity named on the site | Twilio checks the name-to-site relationship. Footer is fine. |
| B3 | Privacy Policy URL | Not needed Thursday. Needed later for every academy campaign. Must include a no-sharing statement and must not be login-gated. |
| B4 | Terms of Service URL | Same: campaign-time requirement, since 2026-06-30. |

### Gate C: authorized representative (Zoran)

| # | Item | Rule |
|---|---|---|
| C1 | First and last name | Real person with actual authority. |
| C2 | Job title and job position | A real title plus the dropdown position (CEO, Director, etc.). |
| C3 | Phone | **E.164** format, e.g. `+14165551234`. |
| C4 | Email | On the FullControl domain. **Free, personal, or distribution addresses fail the brand.** No gmail, no info@. |

### Gate D: the Twilio submission (Zoran)

| # | Item | Rule |
|---|---|---|
| D1 | New account created, upgraded off trial, billing added | |
| D2 | Business identity | **ISV / Reseller / Partner**, not Direct Customer. |
| D3 | Address entry | Use the Console **address autocomplete**, do not type free-hand. |
| D4 | Industry / vertical | EDUCATION, matching what `register-a2p.js` defaults to. |
| D5 | Submit | Up to 48 hours to review. Nothing to upload at this stage. |

### Gate E: portal rewiring (build queue, only after D approves)

| # | Item |
|---|---|
| E1 | Swap `TWILIO_MASTER_ACCOUNT_SID`, `TWILIO_MASTER_API_KEY_SID`, `TWILIO_MASTER_API_KEY_SECRET` on Vercel prod **and** preview. Use `printf`, not `echo`, so no trailing newline lands in the stored value. |
| E2 | Set `TWILIO_PRIMARY_PROFILE_SID` to the newly approved profile SID. This is the flag that un-gates the whole A2P chain. |
| E3 | Verify `TWILIO_A2P_POLICY_SID` on the first live run. The code carries a `VERIFY ON FIRST LIVE RUN` comment on the fallback value. |
| E4 | Smoke test the subaccount chain end to end against one academy. |

---

## Fallback: manual verification

Trigger: the Thursday submission comes back 18602 again.

| | |
|---|---|
| **How** | Open a Twilio Support ticket referencing the profile SID and attach the complete EIN letter (CP 575, or 147C if that is what you have). TrustHub correspondence runs through `trusthub-verify@twilio.com`, which replaced `verifymyaccount@twilio.com` on 2024-11-01. |
| **Lead time** | Roughly 5 to 7 business days. |
| **Cost** | None. |
| **Why it works** | It bypasses the automated third-party database lookup entirely and verifies against the IRS document directly, which is exactly the failure mode a fresh EIN causes. |

---

## Downstream implication worth knowing now

Once the FullControl Primary Profile is approved, each academy still needs its **own** Secondary
Customer Profile and brand, registered under **that academy's own EIN**. One ISV brand cannot cover
unrelated businesses.

Practically: every academy owner must supply their own legal name, EIN, CP 575-accurate details, live
site, privacy policy, terms, and an authorized rep on their own domain. Worth building an onboarding
intake step for this rather than chasing it per academy.

---

## Sources

- [Primary compliance profiles](https://www.twilio.com/docs/trust-hub/profiles/primary-compliance-profiles)
- [A2P 10DLC: Gather the Required Business Information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)
- [Customer Profiles (rejection and resubmit behaviour)](https://www.twilio.com/docs/trust-hub/trusthub-rest-api/customer-profiles)
- [Error 18601, name to website association](https://www.twilio.com/docs/api/errors/18601)
- [TrustHub email address change](https://www.twilio.com/en-us/changelog/TrustHub-email-address-change)

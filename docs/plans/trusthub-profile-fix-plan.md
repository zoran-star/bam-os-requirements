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
to wait a month. **Do not.** A rejection is cheap and is the required first step of the fallback:

- No fee to submit the profile
- Nothing to upload at profile stage
- You edit and resubmit the same profile
- Review is up to 48 hours

And critically: **the appeal path requires a failed submission to appeal against.** So the "wasted"
attempt is not wasted. It is what opens the manual vetting route.

**Correction to an earlier draft of this plan:** resubmission is not unlimited. Twilio documents
**three free resubmissions**, after which you must contact Support. That limit is documented at the
*brand* stage rather than the primary profile, but treat three as the working budget at every stage.
Consequence: do not use attempts as a guessing game. Get the CP 575 in hand and submit once, correctly.

Waiting 30 days still has a real cost and no benefit.

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
| A2 | Legal business name | Exactly as on the CP 575, character for character. **Never abbreviate. No DBA or trade name.** `LLC` vs `L.L.C.` is its own rejection cause. Submit the entity line only, not member or officer names printed on the letter. |
| A3 | EIN | Formatted `00-0000000`, dashes included. **Never a DUNS number** for a US entity. |
| A4 | Business type | Corporation / LLC / Partnership / Non-profit, matching the registration. |
| A5 | Physical address | The **official registered address**, not a branch or mailing location. Matches tax records, **no PO box**, and must be **USPS-deliverable** since Twilio validates against the USPS database. |
| A6 | EIN issue date noted | Drives which timeline branch you are on. |

### Gate B: web presence (build)

| # | Item | Rule |
|---|---|---|
| B1 | Live FullControl site | Reachable, not parked, not login-gated, no redirect to an unrelated domain. On **FullControl's own custom domain**, not a site-builder subdomain. |
| B2 | Legal entity named and branded on the site | Business name plus logo visible, with enough public information to identify the company. Twilio checks the name-to-site association; a bare landing page with no company identity is what fires error 18601. Footer placement is fine. |
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

## Tips to maximize approval odds

From a 2026-07-26 scan of Twilio's own docs plus practitioner sources (GoHighLevel's ISV support
portal, SignalWire, Close, and several 2026 registration guides). Reddit itself is not crawlable, so
"forum" coverage here comes from ISV support portals and practitioner guides instead.

**Read the stage column.** Some rules bite at the Primary Profile (what we submit Thursday), others
only at the per-academy Brand and Campaign stages later. Both are listed because the same EIN and
legal-name lookup underlies all of them.

| # | Tip | Stage |
|---|---|---|
| T1 | **Never abbreviate the legal name, and never use a DBA or trade name.** "LLC" vs "L.L.C." vs a missing "LLC" is a documented rejection cause on its own. | Profile + Brand |
| T2 | **Submit only the business entity line from the CP 575.** Do not include member or officer names that appear on the letter. | Profile + Brand |
| T3 | **Use the official registered company address, not a branch or mailing location.** Twilio validates addresses against the **USPS database**, so it must be USPS-deliverable and in USPS standard format. Use the Console autocomplete. | Profile + Brand |
| T4 | **The website must be clearly branded**: business name and logo visible, enough public information to identify the company. A bare landing page with no company identity is what triggers error 18601. | Profile + Brand |
| T5 | **Use a custom domain.** If the site sits on a third-party builder, put it on FullControl's own domain rather than a `*.webflow.io` style subdomain, or make the branding unmistakable. | Profile + Brand |
| T6 | **Business email on the company domain**, e.g. `hi@yourdomain.com`. Free (gmail, outlook), personal, and distribution addresses are documented brand-failure causes. | Profile + Brand |
| T7 | **Register the minimum number of brands per EIN.** Reusing one EIN across multiple brands is a documented rejection cause. FullControl's EIN should appear on exactly one brand. | Brand |
| T8 | **Consistency is scored, not just pass or fail.** Mismatches across name, address, website and Twilio account details lower your **Trust Score**, which determines message throughput and deliverability. A sloppy approval still costs you daily send volume. | Brand |
| T9 | **Attach the CP 575 as a PDF** when appealing. Practitioner guides report that supplying it "removes the guesswork and significantly improves first-time approval." | Appeal |
| T10 | **Write a specific campaign description** later. Vague descriptions that do not explain the campaign's actual purpose are the single most cited campaign rejection cause. | Campaign |
| T11 | **Education vertical is clean.** The prohibited list (lending, debt relief, crypto, gambling, sweepstakes, stock alerts, lead-gen marketing) does not touch us. One less risk. | Campaign |

### On EIN age, the sources disagree and that is fine

| Source | Claim |
|---|---|
| Twilio | Newly issued tax IDs take **30 to 90 days** to propagate |
| GoHighLevel (ISV) | TCR may reject EINs **under 45 days** old |
| Practitioner guides | EIN must be at least **15 days** old |
| GoHighLevel best practices | Wait **30 to 90 days** from issuance before reapplying |

FullControl's EIN is roughly 60 to 90 days old, which clears every stated minimum and sits at the
optimistic end of the propagation window. **This strengthens the case for submitting Thursday** rather
than waiting. We are past the hard floors and only exposed to the soft tail of propagation, and the
appeal exists precisely for that tail.

### The single highest-leverage action

Everything above reduces to one thing: **have the CP 575 open on screen while filling the form and
copy each field off it.** T1, T2, T3 and the original 18602 rejection are all the same failure, which
is typing business details from memory instead of from the source document.

---

## Fallback: appeal to manual vetting

Trigger: the Thursday submission comes back 18602 again.

Twilio documents a specific escalation for exactly our situation, described as "your information
matches tax records but still fails." That is the fresh-EIN case verbatim.

| | |
|---|---|
| **What it is** | An **appeal**, which routes the submission to **manual vetting by Twilio's ecosystem partner** instead of the automated database lookup. |
| **How** | Open a Twilio Support ticket referencing the profile SID and attach the complete EIN letter as a **PDF** (CP 575, or 147C if that is what you have). TrustHub correspondence runs through `trusthub-verify@twilio.com`, which replaced `verifymyaccount@twilio.com` on 2024-11-01. |
| **Lead time** | Roughly 5 to 7 business days. |
| **Cost** | **$10** for the appeal-based manual vetting, separate from standard submission charges. Documented at the brand stage; budget for it either way. |
| **Why it works** | It bypasses the automated third-party lookup and verifies against the IRS document directly, which is exactly the failure mode a newly issued EIN causes. |

Twilio explicitly names newly issued tax IDs as a valid appeal reason: they "may not yet have
propagated to the databases that Twilio and our ecosystem partners use for vetting purposes."

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
- [Troubleshooting A2P 10DLC Standard/LVS brands](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-standardlvs-brands) (3 free resubmissions, $10 appeal to manual vetting, newly issued tax IDs named as a valid appeal reason)
- [GoHighLevel: A2P 10DLC brand approval best practices](https://help.gohighlevel.com/en/support/solutions/articles/155000000508) (no abbreviations, no DBA, entity line only, registered address not branch, Trust Score)
- [GoHighLevel: campaign rejection reasons and resolutions](https://help.gohighlevel.com/support/solutions/articles/155000004746) (minimum brands per EIN, business email not free/personal, EIN under 45 days)
- [Twilio Help: why was my A2P 10DLC campaign registration rejected](https://help.twilio.com/articles/15778026827291-Why-Was-My-A2P-10DLC-Campaign-Registration-Rejected-)
- [Twilio: troubleshooting Sole Proprietor brand registration failures](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-sole-proprietor-brand-registration-failures)
- [SignalWire: campaign vetting tips for TCR](https://signalwire.com/blogs/industry/campaign-vetting-tips-for-tcr)
- [Close: what to do when A2P SMS registration is rejected](https://help.close.com/docs/a2p-sms-registration-rejected)

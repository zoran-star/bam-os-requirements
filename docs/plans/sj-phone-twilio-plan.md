# San Jose phone plan: decisions, timeline, build queue

**Decided 2026-07-26** in a planning room with Zoran. Supersedes the open questions in
[`bam-ghl-agent/docs/twilio-a2p-ghl-migration.md`](../../bam-ghl-agent/docs/twilio-a2p-ghl-migration.md)
(Rosano's research, branch `claude/agent-teams-access-6ba23e`).

---

## TL;DR

| | |
|---|---|
| **Phone does NOT gate the San Jose launch** | SJ launches with texting + calling running on GHL transport inside the portal inbox. Lij never sees the difference. |
| **SJ's number** | Confirmed LC Phone native (Zoran, first-hand). Exit = one GHL support ticket, 1-2 business days, no LOA. |
| **Custody for SJ** | **Lij owns his own Twilio account. Permanent, not a bridge.** |
| **Custody long term** | Scenario A (BAM master + subaccount per academy) stays the model for every OTHER academy. |
| **Blocking BAM-side** | BAM's TrustHub Primary Profile is `twilio-rejected` (error 18602). Hard gate on all future academies. Separate planning session spun up. |
| **New Twilio rule** | Since 2026-06-30 campaign registration requires live Privacy Policy + Terms URLs. **SJ's site must publish before Lij can submit his campaign.** |

---

## Verification verdict on Rosano's doc

Checked against current Twilio + GHL documentation on 2026-07-26.

### Correct, keep

| Claim | Status |
|---|---|
| Campaign review 10-15 days | Confirmed, current Twilio banner |
| Brand approval in minutes | Confirmed (clean Sole Prop / Low Volume Standard) |
| Unregistered US traffic HARD blocked, error 30034, since 2023-09-01, blocked sends still billed | Confirmed |
| A2P registration never travels with a number between accounts; config + opt-outs reset | Confirmed |
| A number sits in only ONE Messaging Service at a time | Confirmed |
| Sole Proprietor campaign = 1 number only | Confirmed |
| Brand + Campaign need NO phone number at creation, so both can be fully approved before the number arrives | Confirmed. This is the load-bearing claim and it holds. |
| Register A2P FIRST, move the number second | Confirmed as the right sequence. Rosano flagged it as inferred; the underlying facts are all documented, so no Twilio ticket needed. |
| ISV model: per-client subaccount, each client its own Secondary Profile + Brand under the client's own EIN | Confirmed. One agency brand cannot cover unrelated businesses. |
| Post-approval carrier registration of each number is async, hours to days, can fail | Confirmed. Remedy is Twilio support, no documented auto-retry. |

### Corrections

| # | Doc says | Actually |
|---|---|---|
| 1 | "Zero existing Twilio integration, this is a from-scratch build" | **Wrong.** The full Twilio spine shipped 2026-06-29 to 07-13: provider toggle, encrypted per-client creds, inbound webhook, delivery receipts, voice + voicemail, staff Phone tab, ISV A2P registration chain, port watcher cron, usage metering + rebill. See [`bam-ghl-agent/memories/project_twilio_messaging_spine.md`](../../bam-ghl-agent/memories/project_twilio_messaging_spine.md). |
| 2 | Schema proposal: `twilio_enabled`, `twilio_phone_number` on `clients`, or a new `client_twilio_numbers` table | **Already exists** as `clients.messaging_provider` + `client_twilio_config` (applied to prod). Do NOT create `client_twilio_numbers`. |
| 3 | Build `api/twilio/send-message.js` + `api/twilio/inbound-webhook.js` | **Already exist.** 17 routes under `bam-ghl-agent/bam-portal/api/twilio/`. |
| 4 | A2P fees "~$4/mo brand + ~$10/mo campaign" | Brand is **one-time**, not monthly: $4.50 Sole Prop / Low Volume Standard, $46 Standard. Campaign: $15 one-time vetting + monthly by type. We register LOW_VOLUME = **$1.50/mo**, not $10. |
| 5 | Scenario A vs B framed as open | Decided 2026-06-29 in favour of A, and the built tooling assumes it. |
| 6 | Missing entirely | **Since 2026-06-30 a campaign registration REQUIRES a Privacy Policy URL and a Terms & Conditions URL.** Doc predates the rule. |

### Also stale: our own memory note

`project_twilio_messaging_spine.md` says the LC Phone exit is a "PORT-OUT via GHL support + LOA, ~1-3 wks".
**That is wrong now.** GHL currently documents it as an internal account-to-account move via one support
ticket, **1-2 business days, no LOA**, run through their internal Number Migration Tool. Rosano is right,
the old note is stale. Fix the note when the build session touches this area.

Ticket contents GHL needs: numbers in E.164, gaining Twilio Account SID, sub-account Location ID,
preferred cutover window. No Twilio-side ticket required.

Do NOT "release" a number by disabling LC Phone for the sub-account. That permanently deletes any
number not released first.

---

## Decisions

### 1. SJ number type: LC Phone native
Zoran confirmed first-hand. Matches the 2026-07-02 port audit which already had San Jose in Wave 0 of
16 US LC-Phone ports. Exit path = GHL support ticket, 1-2 business days.

### 2. Custody: Lij owns his own Twilio account, permanently
Rationale: BAM's own TrustHub profile is rejected, so a BAM subaccount for SJ is blocked behind a fix
with unknown timing (possibly a 30-90 day fresh-EIN wait). Lij-owned unblocks SJ immediately and
independently.

Accepted trade-offs:
- SJ is a one-off, not plug-and-play. Setup is manual; Lij pays Twilio directly.
- Portal connects via the already-supported "connect existing Twilio account" path (paste Account SID +
  token, validate live, pick number, rewire webhooks). No new build.
- Rejected the "temporary bridge then move to BAM" option: A2P never transfers between accounts, so
  that path costs a SECOND full 10-15 day campaign review plus ~$20 in fees plus one extra cutover
  with an outbound-SMS gap. Permanent Lij-owned avoids paying twice.
- Scenario A remains the model for every other academy.

### 3. Launch model: launch on GHL transport, flip to Twilio after
Phone comes off the critical path entirely.

- Big-bang launch fires when site / Stripe / drips / agents are ready. Texting and calling work on day 1,
  in the portal inbox, with GHL as the transport underneath.
- Lij's Twilio track runs in the background and lands whenever it lands.
- One switch on the staff Phone tab (`api/twilio/provider-switch.js`) flips SMS + voice to Twilio.
- **Hard constraint: SJ's GHL sub-account and contact sync must stay alive until the flip completes.**
  GHL transport is doing the actual sending. Never cancel GHL mid-migration.

### 4. Sequencing: proceed, no Twilio support ticket
Every load-bearing claim is now confirmed from official docs, and the number type is known first-hand.
Nothing left worth a ticket.

### 5. Portal threading: merged, already built
Inbound Twilio SMS lands in the SAME conversation thread as GHL history. `sms_threads` is unique on
(client_id, contact_phone) with provider recorded per message; the history importer backfills GHL
messages into the same store at cutover. The inbox UI is provider-agnostic. No decision, no build.

### 6. Privacy Policy + Terms: site publishes first
New Twilio rule (2026-06-30) makes both URLs required at campaign registration. SJ's site is
staging-only. **Decision: publish the site, then apply.** This puts the site launch UPSTREAM of the
10-15 day campaign clock, so the Twilio flip lands roughly 3 weeks after the site goes live rather than
3 weeks after the EIN arrives.

---

## Timeline

```
                         SAN JOSE LAUNCH TRACK  (phone-independent)
  site build ──► review with Lij ──► BIG-BANG LAUNCH
                                     website + drips + agents + payments + Stripe
                                     texting & calling LIVE via GHL transport
                                     GHL sub-account stays alive
                                            │
                         PHONE TRACK        │  (starts at site publish, gates nothing)
  site published ────────────────────────────┘
        │
        ├─► Lij creates Twilio account + payment method .......... ~30 min, his task
        ├─► Lij business profile + EIN ........................... approval up to 48 h
        ├─► Brand registration .................................. minutes
        ├─► Campaign registration ............................... 10-15 DAYS  ◄── longest item
        │      needs: privacy policy URL + terms URL (live)
        │      needs: opt-in language + 2 sample messages
        ├─► GHL move ticket (submit only after campaign VERIFIED)  1-2 business days
        ├─► Number lands in Lij's Twilio ........................ config + A2P reset to zero
        ├─► Wire webhooks to portal endpoints ................... minutes, scripted
        ├─► Add number to the approved Messaging Service ........ minutes
        ├─► Carrier registration of the number .................. hours to ~2 days
        └─► Flip the staff Phone tab switch ..................... instant

  ELAPSED, from site publish to Twilio live: ~3 to 4 weeks
```

### Downtime at cutover

| Channel | Gap | Why |
|---|---|---|
| Voice | **Zero** | No A2P on voice. Works the moment VoiceUrl is wired. |
| Inbound SMS | **Minutes** | Just the webhook rewiring window. Scripted. |
| Outbound SMS | **Hours to ~2 days** | Carriers register the number only after it joins the approved campaign. Unavoidable in every scenario. Warn Lij in advance. |

Because of the launch model, this gap lands weeks AFTER launch, not on launch day.

---

## BAM TrustHub fix (separate track, blocks all future academies)

**Status: `twilio-rejected` since 2026-07-06. Error 18602, "The Business ID you provided could not be
verified."** Profile `BU3557…f0bd`, friendly name "FullControl". Cause: submitted with the older
entity's details, so the EIN + legal name pair did not match IRS records.

**This is a hard gate.** Twilio, verbatim: a Primary Business Profile must be `twilio-approved` before
any Secondary Customer Profile exists, which means no client brand and no client campaign. Also note
`register-a2p.js` is env-gated on `TWILIO_PRIMARY_PROFILE_SID`, which is not set on Vercel, consistent
with never having been approved.

Prep needed (own planning session, handed to MISTER_ORCHESTRATOR):
- **IRS CP 575 letter** for the current corp. This is the single source of truth. Lost it, request a 147C.
- Legal name character for character off the CP 575. Not a DBA, not the W9 name.
- EIN as 00-0000000. Never DUNS for a US entity.
- Business identity = ISV / Reseller / Partner.
- Physical address matching tax records, no PO box, entered via Console autocomplete.
- Live website that names the legal business.
- Authorized rep: name, real title, job position, E.164 phone, and an email whose domain matches the
  website domain.

Two traps specific to us:
- **Fresh EIN needs 30-90 days** to reach the verification databases. If the new corp's EIN is recent,
  correct typing will not save it. Route around via trusthub-verify@twilio.com with the CP 575 attached,
  manual verification in 5-7 business days.
- **Identity consistency.** The profile says "FullControl" while the rep email is on
  byanymeansbusiness.com. Legal name, website domain, and rep email domain must tell one story or
  errors 18601 / 18606 fire next.

Mechanics: edit and resubmit the same profile, no new one needed. No fee, no documented resubmission
limit at profile level. Review up to 48 hours. Nothing is uploaded, it is all typed, so accuracy is
everything.

---

## Build queue

Nothing here blocks the SJ launch. Ordered by urgency.

### 1. A2P campaign payload: add the two now-required URLs
`bam-ghl-agent/bam-portal/api/twilio/register-a2p.js:240` builds the campaign with
`BrandRegistrationSid`, `Description`, `MessageFlow`, `MessageSamples`, `UsAppToPersonUsecase`,
`HasEmbeddedLinks`, `HasEmbeddedPhone`. It does **not** send a privacy policy URL or a terms URL,
which Twilio has required since 2026-06-30. Any campaign this route submits today will be rejected.

- Add both fields to the payload.
- Source them per client rather than hardcoding, since each academy has its own site. Likely from the
  client's website config; needs a place to live if there isn't one.
- **Schema touch, so route it through the `align-core-data-model` skill** before committing, per the
  repo rule.

### 2. Wire the "connect existing Twilio account" path end to end for SJ
The paste-SID-and-token path is designed and partially present. Confirm it covers: live credential
validation, number selection, Messaging-Service-aware webhook rewiring, encrypted write to
`client_twilio_config`, and status. This is the path SJ actually uses, so it needs to be real.

### 3. Fix the stale LC Phone claim in memory
`bam-ghl-agent/memories/project_twilio_messaging_spine.md` says LOA port, 1-3 weeks. Correct it to
internal account move, 1-2 business days, no LOA.

### 4. Not needed, do not build
- `client_twilio_numbers` table. `client_twilio_config` already covers it.
- `api/twilio/send-message.js`, `api/twilio/inbound-webhook.js`. Both exist.
- New inbox UI for merged threads. Already provider-agnostic.

---

## What changes on Lij's ask-list

| Item | Change |
|---|---|
| EIN | **No longer urgent for BAM.** Under Lij-owned Twilio he enters his EIN into his OWN Twilio profile, he does not send it to us. Still worth having on file. |
| New ask: create a Twilio account | Account + payment method + business profile. His task, ~30 min plus up to 48 h review. |
| New ask: privacy policy + terms content | Both pages must be live on his site before campaign submission. Needed for the site anyway. |
| New ask: opt-in language + sample messages | Campaign registration asks how parents consent and wants 2 example texts. We can draft from the templates already in `register-a2p.js`. |
| Number type question | **Closed.** LC Phone native, confirmed. |
| Warn him | One-time outbound texting gap of hours to ~2 days on cutover day, weeks after launch. |

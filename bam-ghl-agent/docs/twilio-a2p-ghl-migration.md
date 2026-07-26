# Twilio Number Migration from GHL/LC — A2P Sequencing + Portal Connection

**Status:** Draft for review — needs Zoran's decisions on the flagged items before build starts.
**Repo state checked:** `bam-ghl-agent/bam-portal/` — **zero existing Twilio integration.** All SMS today goes through GHL's own Conversations API (`api/ghl/send-message.js`), which uses Twilio under the hood on GHL's account, not ours. This is a from-scratch build.

---

## 🚩 Answer this first — it changes the whole procedure

**Is the client's number a native LC Phone number (Twilio infrastructure GHL manages for them), or is it already sitting on the client's own separate Twilio project that's just connected to GHL?**

| If it's... | The move is... | Timeline |
|---|---|---|
| Native LC Phone number | An **internal Twilio account-to-account move** (GHL Support ticket) | **1–2 business days** |
| Already on a separate Twilio project | A standard **carrier LNP port** (LOA + CSR + bill copy) | **2–4 weeks** |

GHL's docs treat these as two different products with two different processes. Confirm which one applies before scheduling anything with the client.

---

## ✅ Yes — it's safe to register on Twilio while GHL still has it

**Your question:** is it ok to start A2P registration on the new Twilio account while the same number is still actively A2P-registered under GHL/LC?

**Answer: yes, completely safe — and it's exactly what you should do.** Here's why there's no conflict:

- **Brand registration** (via The Campaign Registry/TCR) is a record of a *business entity* — legal name, EIN, address. It has no field for a phone number at all.
- **Campaign registration** is a *use-case* declaration tied to that Brand, created against a Messaging Service — also no phone number required at creation.
- The only step that touches the actual number is adding it to a **Messaging Service's Sender Pool** — and that requires the number to already be an **owned resource inside that specific Twilio account**. Since the number is still living in GHL/LC's infrastructure, it physically can't be added to your new account's Sender Pool yet anyway.

So there's nothing to "conflict" with during prep — Brand approval and Campaign review (the slow part, 10–15 days) can run entirely in parallel while the client stays fully live on GHL. The only real pinch point is later, at Sender Pool attachment, which can't happen until after the number has actually moved.

One nuance found in Twilio's own numbers-transfer docs, worth planning around: when the number *does* move accounts, it **loses its existing config** — "You will need to reconfigure, setup Opt-Outs and re-register the numbers on the new account." Confirms there's no partial/leftover state to worry about either way. — [Twilio: Moving Phone Numbers to another Twilio Account](https://support.twilio.com/hc/en-us/articles/223135327-Moving-Twilio-Phone-Numbers-to-another-Twilio-Account)

---

## Two ways to hold the destination account

You still need to decide **who owns the Twilio account** the number lands on. Two scenarios — and the important finding: **compliance effort is identical in both.** Every end client needs their **own** Brand, registered under their **own** EIN, no matter which model you pick. Twilio's ISV docs are explicit that one agency Brand cannot cover multiple unrelated client businesses — each subaccount still gets its own Secondary Customer Profile + Brand + Campaign. ([Twilio: ISV A2P 10DLC Onboarding Overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv)) So this decision is a **billing/custody** call, not a compliance shortcut.

| | **Scenario A — BAM's Twilio account** (client as subaccount) | **Scenario B — Client's own Twilio account** |
|---|---|---|
| **Brand/EIN** | Client's own business identity — same either way | Client's own business identity — same either way |
| **Billing** | One consolidated BAM invoice across all client subaccounts | Client pays Twilio directly |
| **Credentials** | BAM holds and manages the keys centrally | Client holds their own keys (or grants BAM access) |
| **Portability if client leaves** | Number + Brand must be moved out and re-registered elsewhere | Client already owns it — nothing to hand over |
| **Ops overhead** | More subaccounts to manage under one login, one dashboard | BAM needs a way to access N different client consoles/credentials |
| **Best fit** | BAM wants central control + one bill, is comfortable holding client credentials long-term | Client wants to own their own infrastructure outright, or plans to eventually self-manage |

> ⚠️ Twilio explicitly recommends the subaccount pattern (Scenario A) as the "preferred architecture" for agencies — but only because it keeps each client's traffic isolated for compliance purposes, not because it reduces registration work. There's no Twilio-documented "easy button" for converting a subaccount into a fully independent client-owned account later — plan for the same reconfiguration effort as a fresh port if a client ever leaves under Scenario A.

---

## The core fact: A2P does not move with the number

A2P 10DLC registration is a chain: **Brand → Campaign → Messaging Service → Sender Pool (the number)**. That whole chain lives inside **one specific Twilio account**. GHL's own docs say it plainly:

> "A2P status is at the sub-account level and does not move with the phone number; reattach the correct brand/campaign after moving." — [HighLevel: Moving Numbers Across Sub-Accounts](https://help.gohighlevel.com/support/solutions/articles/48001203968-moving-numbers-across-sub-accounts-same-agency-)

**What this means:** the client's existing "A2P approved" status under GHL/LC is worthless the moment the number leaves that Messaging Service. Landing on our Twilio account means registering a brand-new Brand + Campaign there, full stop — no shortcut, no transfer.

A number also **cannot be dual-registered.** It can only sit in one Messaging Service's Sender Pool at a time.

---

## The answer to your question: register A2P first

**Recommended order:**

1. Stand up A2P Brand + Campaign on the destination Twilio account **first**
2. Get the Campaign **approved**
3. *Then* execute the number move/port
4. Add the number into the already-approved Messaging Service's Sender Pool during a tight, planned cutover window

**Do NOT** port first and "sort out A2P after we're off GHL." That leaves the number sending **unregistered US traffic** — which Twilio hard-blocks (error 30034, in effect since Sept 2023), not just deprioritizes. You'd eat a real messaging blackout for however long campaign review takes (currently **10–15 days**), and you'd still get billed for every blocked send attempt.

> ⚠️ **Honesty check:** No Twilio or GHL document states this sequencing recommendation for this *exact* GHL-exit scenario explicitly. This is inferred from Twilio's own documented behavior in the closest scenario they do cover (moving a number to a new Standard Campaign), where they warn of "risk of service interruption for up to several weeks" if you don't pre-clear the new registration first. Treat it as the safest inferred path — worth a quick sanity check with Twilio support given how compliance-sensitive this is, but don't let that block moving forward.

### Why "port first, register later" tempts people (and why it's still wrong here)
It feels safer to "get the number off GHL, then deal with paperwork." But the number doesn't go dark by staying on GHL a little longer — it goes dark the moment it's unregistered anywhere. Registering first costs you nothing while the number is still live and working on GHL.

---

## Step-by-step: GHL side (release the number)

1. Confirm the number type (see 🚩 above) — this determines which of the two flows below applies.
2. **If native LC Phone number** → open a HighLevel Support ticket with:
   - Phone number(s) in E.164 format
   - Destination ("gaining") Twilio Account SID
   - Destination sub-account Location ID (Settings → Business Profile)
   - Preferred cutover window
   - You do **not** need to also open a Twilio-side ticket — GHL Support coordinates the move end-to-end.
   - Source: [Moving Numbers Out of an LC Phone Sub-account to the Client's Own Twilio Account](https://help.gohighlevel.com/support/solutions/articles/48001240107-moving-numbers-out-of-an-lc-phone-sub-account-to-the-client-s-own-twilio-account)
3. **If already on a separate Twilio project** → this is a standard LNP port on the Twilio side (see below); no GHL move-ticket needed, but you should still disconnect GHL's messaging integration pointed at that number once the port completes.
4. **Do NOT disable LC Phone for the sub-account** as a way to "release" the number — GHL warns this **permanently deletes** any number not explicitly released first. Only use the Disable LC Phone flow if you're decommissioning the whole sub-account, and release numbers *before* submitting that form.
5. After the move ticket completes, explicitly verify in GHL that the number's brand/campaign association is actually cleared — GHL's own docs imply this isn't automatically guaranteed, only that you should check it.

## Step-by-step: Twilio side (receive the number + register A2P)

1. **Create a Trust Hub Customer Profile** → register a **Brand** (Standard, or Low-Volume Standard if under 6k msgs/day) via The Campaign Registry. Approval: near-instant to a few minutes for a clean submission.
2. **Register a Campaign** under that Brand. **Budget 10–15 days** for approval (Twilio's current review time).
3. **Create a Messaging Service**, and add the number as a **Sender** — this step can run in parallel with Campaign review, as soon as the number physically exists in the account.
4. Once the Campaign is approved, every number in that Messaging Service's Sender Pool gets registered with carriers automatically (not instant — can take additional time/retries per Twilio's troubleshooting docs).
5. **If a true LNP port** (see 🚩): also submit the port-in request — LOA (Twilio now e-signs this, no manual PDF), CSR from the losing carrier, and a phone bill copy dated within 30 days matching the LOA. Standard ports (<50 numbers) run 2–4 weeks.

## Timeline summary

| Step | Owner | Time |
|---|---|---|
| Brand registration | Twilio | Minutes |
| Campaign approval | Twilio | 10–15 days |
| Number move (native LC Phone) | GHL Support | 1–2 business days |
| Number port (separate Twilio project) | Twilio | 2–4 weeks |
| Carrier registration after Campaign approval | Automatic | Hours–days, can fail/retry |

**Net plan:** kick off Brand + Campaign registration on day 1. Don't touch the GHL-side move/port until the Campaign is approved. Total elapsed time is dominated by Campaign review (~2 weeks), which should run while the client is still fully live on GHL — no reason to touch their working number while waiting.

## Other gotchas worth knowing before you scale this to more clients

- A2P fees (~$4/mo brand + ~$10/mo campaign) recur on **our** account even though the client already paid them once under GHL.
- If we consolidate multiple client numbers under **one shared Brand**, note: a **Sole Proprietor** campaign type only allows **one number per campaign** — fine for single-number moves, but plan Brand/Campaign structure deliberately if BAM repeats this migration across many clients (per-client Brand vs. one BAM agency Brand with per-client Campaigns).
- There is no single official "leaving GoHighLevel for Twilio" playbook from either company — this doc assembles GHL's generic account-move tooling + Twilio's generic A2P onboarding, because neither publishes one for this specific exit scenario.

---

## Connecting the number to the client portal

Grounded in the actual codebase (`bam-ghl-agent/bam-portal/`):

**Today:** SMS sending lives in `api/ghl/send-message.js`, which POSTs to GHL's LeadConnector Conversations API (`https://services.leadconnectorhq.com/conversations/messages`). Per-client GHL tokens are stored directly on the `clients` table (`ghl_access_token`, `ghl_refresh_token`, `ghl_location_id`), following the OAuth pattern in `api/messaging/connect.js`.

**Net-new work required** (nothing to migrate — this is a parallel path, not a replacement, since most clients will stay on GHL's SMS):

1. **New env vars** on the Vercel project: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or API Key SID/Secret), `TWILIO_MESSAGING_SERVICE_SID` per client (or a lookup table if multiple).
2. **Schema addition** — new columns on `clients` (or a dedicated `client_twilio_numbers` table if BAM plans to migrate several clients — cleaner for 1-to-many later):
   - `twilio_enabled` (boolean)
   - `twilio_phone_number`
   - `twilio_messaging_service_sid`
   - ⚠️ Per this repo's own convention (`CLAUDE.md`), run the **`align-core-data-model`** skill before committing any schema change — this keeps the change aligned with the `fc-core-srvc` production direction, not just the Supabase prototype.
3. **New API routes**, mirroring the existing `api/ghl/` structure:
   - `api/twilio/send-message.js` — same shape as `api/ghl/send-message.js`, but calls the Twilio Messages API instead. Branch on `clients.twilio_enabled` to decide which provider a given client uses.
   - `api/twilio/inbound-webhook.js` — receives inbound SMS/status callbacks from Twilio, mirrors the shape of the existing `api/ghl/inbound-webhook.js` so it lands in the same conversation/thread UI the client portal already renders.
4. **UI:** the client-portal messaging tile (in `bam-portal/public/client-portal.html`) doesn't need new UI if the API layer normalizes both providers into the same message shape — the portal just keeps rendering "conversations," unaware of which carrier sent them.
5. **Test plan:** once wired, verify end-to-end the same way the existing staff-only "Test GHL SMS" button does today, but pointed at the Twilio path — send a test message, confirm delivery + inbound reply lands in the portal thread.

---

## Open questions for Zoran

- [ ] Native LC Phone number, or already on a separate Twilio project? (determines 1–2 day vs 2–4 week timeline)
- [ ] Scenario A (BAM's account) or Scenario B (client's own account)? Note: each client gets their own Brand either way — this is a billing/custody call, not a compliance one.
- [ ] Confirm with Twilio support directly on the sequencing recommendation above, given no official doc covers this exact scenario — want us to open that ticket, or are you comfortable proceeding on the inferred plan?
- [ ] Should inbound Twilio SMS show up merged into the same conversation thread as GHL messages in the portal, or as a separate channel?

## Next actions

- [ ] Confirm number type with the client (🚩 above)
- [ ] Create Twilio account/subaccount for this client
- [ ] Register Brand → Campaign (start the ~2 week clock)
- [ ] While waiting: scaffold `client_twilio_numbers` schema + `api/twilio/*` routes
- [ ] Once Campaign approved: submit GHL move ticket or Twilio port
- [ ] Cutover + verify messaging end-to-end in the portal

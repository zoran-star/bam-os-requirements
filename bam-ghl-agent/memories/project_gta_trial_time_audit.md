---
name: GTA trial-time incident + confirm-agent fixes (2026-07-04)
description: Sandhu 8:30-vs-12:30 incident. Root causes, PRs #1121/#1123 shipped, GHL -4h parse still open, 2 unbuilt upgrades Zoran wants. RESUME HERE.
type: project
---

# GTA free-trial time/address incident (2026-07-04) - RESUME NOTE

Trigger: Sandhu family showed at 8:30 AM for a 12:30 PM trial.
Audit artifact (with per-person save actions + resolution log):
https://claude.ai/code/artifact/0acba0ca-2b6c-433c-9569-07162bce0176

## 3 root causes

1. **GHL -4h parse - STILL OPEN.** GHL `/contacts/{id}/appointments` returns
   offsetless wall-clock times; `new Date()` on the UTC server reads them -4h
   (12:30 PM -> 8:30 AM). Hit Sandhu/Monga/Pappas/Lack/Agboola. Moot while nobody
   books manually in GHL, but the raw-parse code still lives in `api/agent-confirm.js`
   (A3 `trialAppts` + `nextAppointment`) and `api/agent/booking.js` GHL branch.
   Fix if GHL manual booking ever resumes: parse offsetless times in the client's
   `time_zone` (America/Toronto), not UTC.

2. **Stuck sender - FIXED (PR #1121, merged).** `phoneForContact` in
   `api/messaging/provider.js` only read `sms_threads`, so first-touch leads (never
   texted us) failed "no phone for twilio send" forever, swallowed by `catch(_){}`.
   Every website-booked confirmation (Coetzee/McGilvery/Gargurevich) sat `approved`
   unsent since Jul 2. Now: fall back contacts -> ghl_contacts ->
   trial_bookings.parent_phone + E.164 normalize; flush writes `send_error` on
   failure (row stays approved to retry) and clears it on success.

3. **Wrong address - FIXED (PR #1123, merged).** Confirm address chain used
   `clients.address` = the registered business address "2205 Rosemount Cres", NOT the
   gym. Now inserts the OFFER's Blueprint primary location ahead of it:
   `offers.data.general_info.location` (a `locations` id set via the offer wizard's
   General Info "Primary location" picker) -> `locations.address`. GTA training offer
   already pointed at Linbrook. New chain in `agent-confirm.js`:
   slot address -> offerLocationAddress() -> Brain business-info -> clients.address.

## Key facts / gotchas
- **GTA gym = 1079 Linbrook Rd, Oakville** (entrance on the left). `clients.address`
  = 2205 Rosemount Cres = registered business addr, NEVER use for parent-facing copy.
- Offer<->location tie-in ALREADY EXISTS and shows in the offer wizard (General Info
  location_picker, `_bbOfferConfigs`). No build needed there.
- Free-trial form: https://www.byanymeanstoronto.ca/free-trial
- Confirm cron = `agent-confirm?action=detect` at :07/:22/:37/:52 (15-min worst-case
  send lag). Quiet hours 08:00-21:30 America/Toronto (`api/agent/_quiet.js`).
- GTA is portal-native: booking_provider/contact_provider/pipeline_provider = portal,
  messaging = twilio. Pipeline stage ids: scheduled_trial
  947dfe15-44d5-4ef2-b438-9f43fb50d022, interested 69c73f51-7fee-4165-a1a8-ed867152392e.
  Ghosted automation id 7361fd83-5f60-44b7-b124-9454fd5b3315.

## People state after fixes (all done)
- 4 confirmations sent 11:37 AM w/ Linbrook: Monica (rebook form link), Caleb
  (Thu Jul 9 7PM), Josh/McGilvery (Tue Jul 7 8PM), Liam/Gargurevich (Mon Jul 20 7PM).
- Monica Kapoor: never booked -> moved to Interested + Ghosted active.
- Caleb Montemayor: dup GHL appt deleted, portal card created, confirmed.
- Ranjit Sandhu: offered 2 free weeks + reschedule (Zoran handled).
- Stefan/Vidhu/Meg: Zoran texted time corrections manually.
- Missed-trial trio (Agboola/Lack/Qureshy): stay in Missed Trial drip per Zoran.

## Unbuilt - Zoran wants these (NEXT SESSION)
1. **Instant sends:** send-on-approve (fire the moment a row hits `approved` inside
   quiet hours) + move the queue flush to the every-minute worker, killing the 15-min
   cron lag. Zoran asked "why cron, can't we send right away" - answer: queue exists
   for quiet hours + retries + human holds, but cadence is just config.
2. **Automation icon on sales cards:** a small non-distracting animated icon on any
   pipeline card that's in an automation. 5 ideas floated (pulse dot, orbit, slow
   gear, floating paper plane, rippling signal bars); Zoran wants a live preview of
   all 5 to pick from. Not built.

Sibling notes: [[project_confirm_agent]], [[project_sales_crew_model]].

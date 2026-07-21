# Entry-point routing — form fill → stage + bot (BUILT DORMANT, 2026-06-26)

Zoran's model for how a website form-fill plugs into the sales pipeline + who contacts
them. **Wiring is BUILT but DORMANT** behind a flag until Zoran turns OFF the GHL "form
filled" workflows (today those own first-touch + pipeline - see [[project_website_leads]]).
Pairs with [[project_sales_crew_model]].

## The model (per entry point)

### 📝 Contact form
- Card created in the **👻 Ghosted** stage (`ghostedStage`, matches `/interest|ghost/`;
  anchor in `_stage.js ghostedStage`. Role key renamed interested→ghosted 2026-07-21).
- **👻 Ghosted automation enrolls IMMEDIATELY** on form fill (not after a quiet period).
- Lead **replies** → move to **✅ Responded** → 📞 Booking agent (Hawkeye).
- Ghosted runs out silent → **💔 Lead Nurture** (already wired, P6).

### 🏀 Trial form
- Card created in **✅ Responded** stage + start a **20-minute timer**.
  - **Books within 20 min** → move to **📅 Scheduled Trial** → ✅ Confirm bot.
  - **No booking at 20 min** → send ONE SMS nudge, then Booking agent works it in Responded.
    Copy (approx): "Hey it's coach from BAM GTA - noticed you filled in a trial form but
    didn't book a time. Can I help you find a time that works for you? Our next session
    is [ ]". ⬜ OPEN: does "[ ]" = real next availability (via `/api/website/availability`)
    or simpler copy + the free-trial link? (Zoran to confirm.)

## Dormancy + flag config
Gate = `clients.ghl_kpi_config.portal_entry_routing` (object). Absent / `enabled:false` =
today's behavior (leads.js enrolls the GHL `ghl_workflow_id`; GHL owns the pipeline).
Flip ON for an academy by setting:
```json
portal_entry_routing: {
  "enabled": true,
  "pipeline": "<exact GHL pipeline name>",
  "contact_stage": "Interested",
  "trial_stage": "Responded",
  "scheduled_stage": "Scheduled Trial"
}
```
ON = leads.js places the card in the stage + `enrollContact` (ghosted / trial_followup)
AND skips the GHL workflow enroll. **Belt + suspenders:** even with the flag ON, nothing
sends until the ghosted / trial_followup automations are enabled+approved with steps
(`enrollContact` no-ops otherwise).

## What was built (PR pending)
- **`api/website/leads.js`**: `maybePortalRoute(client, contactId, formType, {name,email})`
  (flag-gated) → place opp + `enrollContact`; no-booking form path calls it and skips the
  legacy GHL workflow enroll when it routed; booking-success path (flag ON) →
  `exitEnrollment('trial_followup','booked')` + move to `scheduled_stage`.
- **`trial_followup` automation** (GTA, id `2320e3b7-dbdd-4b34-8119-a751afed90ce`): 1 step,
  wait **20 minutes** → SMS. enabled=false, approved=false (DORMANT). Body uses
  `{{contact.first_name}}` + `{{next_session}}` + the free-trial link.
- **`{{next_session}}` token**: `api/_next_session.js` (`nextSessionLabel`) hits the
  free-trial calendar's free-slots, picks the earliest, formats "Tue Jul 1 at 6:00 PM".
  `automations.js` worker resolves it ONLY when the copy uses the token; phrasing
  ("Our next session is X. ") added in the worker, empty when no slot. Token added to
  `email-shells.js resolveMergeVars` map.
- **Send-time booked guard**: worker, before sending a `trial_followup` step, checks
  `scheduledTrialContactIdSetCached` - if the lead is now in Scheduled Trial (booked via
  ANY path), exit + skip. Reply-exit already wired (inbound-webhook).
- **UI**: `🏀 Trial Follow-up` added to the Train Agent automation picker (`_TA_AUTOS`,
  `_TA_AUTO_ABOUT`, `_AUTO_SEED`, order) so Zoran can review/approve it.
- **Entry Points editor in the Train tab (2026-06-26):** two pills after a divider -
  `📝 Contact Form` + `🏀 Trial Form` (`_TA_ENTRY`/`_TA_ENTRY_ABOUT`, `_taIsEntry`,
  `_taRenderEntryPoints`/`_taEpForm`/`_taEpSave` in client-portal.html). Editable: master
  Portal-routing ON/OFF toggle (the `enabled` flag), Pipeline, the stage each form lands
  in, which automation works it, and (trial) the scheduled-trial stage. Reads/writes via
  `api/agent-config.js` `get-entry-routing` / `set-entry-routing` (authorized by
  `resolveAgentActor.canActOn`). Pipelines/stages from `/api/ghl/pipelines`. So
  `portal_entry_routing` now also supports `contact_automation` / `trial_automation`
  (leads.js reads them, defaults ghosted / trial_followup). **This editor IS the way to
  flip routing on** - no more hand-editing the client row.

## ⬜ NEXT BUILD (DECIDED 2026-06-26) — Booking bot cold-opens with context; retire trial_followup
Zoran's call: make the 📞 Booking bot the single conversational engine. Instead of a separate
20-min trial_followup automation, a trial-form-no-book lead should enter at **Booking with context**
("filled the trial form, didn't pick a time") and the booking bot opens the conversation. Generalizes
to ALL context entries (no-show, etc.). **DO THIS IN A FRESH SESSION** (live-agent code). Interim:
trial_followup still works (dormant), so no gap until this ships.

Entry points to Booking today (all REPLY-triggered): new-lead reply · 👻 ghosted reply · 💔 nurture
reply (won back) · ✅ confirm "can't make it" handoff · (planned) no-show. The bot only drafts when a
lead SENT a message — it cannot cold-open yet. That's the gap to fill.

### ✅ BUILT 2026-06-28 — Booking cold-opener (PR pending)
1. **leads.js `maybePortalRoute`**: dropped the trial_followup fallback. `automationKey` =
   `trial_automation`/`contact_automation` (derived from the stage). If an automation owns the stage
   (Interested→ghosted) → enrol it; ELSE (agent-owned stage, e.g. Responded→Booking) → write an
   `agent_contact_notes` row prefixed **`Entry: ...`** ("Filled the free-trial form but did not pick a
   time...") so the agent opens with context. contact_memory injects it into the prompt.
2. **`api/agent-approvals.js`**: `OPENER_TRAILER` + `buildOpenerSystem`; `runOpener` (seeds one user
   turn, no inbound, same check_availability loop + forced propose_reply); `draftOpener`
   (buildOpenerSystem + loadContactMemory + calendars). NEW opener pass in `detectForClient`: finds
   active `Entry:` notes ∩ respondedIds ∩ not muted; for each with NO prior `agent_ready_replies` row
   AND no GHL conversation → `draftOpener` → queue `agent_ready_replies` pending (`created_by:'opener'`,
   kind reply/book). Cap `OPENER_CAP=5`/run. Mode-gated (only when booking agent on), Hawkeye only.
   Dedupe = never re-open (prior-row check) + never double-text (conversation check). No-reply leads
   fall to the ≥24h ghost forcing-function naturally.
3. **Retired `trial_followup`**: removed from the Train picker (`_TA_AUTOS`/`_TA_AUTO_ABOUT`/`_AUTO_SEED`/
   order). GTA row (`2320e3b7-dbdd-4b34-8119-a751afed90ce`) left dormant (enabled/approved false), now
   unused by leads.js. Trial landing stage (Responded) shows 📞 Booking via the stage-derived display.
All Hawkeye + dormant (portal_entry_routing off). V2 only.

## Status
BUILT DORMANT (entry routing 2026-06-26 + Booking cold-opener 2026-06-28). To go live for GTA:
**Train Agent → 📝 Contact Form / 🏀 Trial Form**: set the pipeline + stages and flip Portal-routing ON;
approve+enable the 👻 Ghosted automation (contact path); make sure the Booking agent is on (Hawkeye) so
it cold-opens trial-no-book leads; then turn OFF the matching GHL "form filled" workflows.
V2/V1.5 only; V1 untouched.

# Entry-point routing — form fill → stage + bot (BUILT DORMANT, 2026-06-26)

Zoran's model for how a website form-fill plugs into the sales pipeline + who contacts
them. **Wiring is BUILT but DORMANT** behind a flag until Zoran turns OFF the GHL "form
filled" workflows (today those own first-touch + pipeline - see [[project_website_leads]]).
Pairs with [[project_sales_crew_model]].

## The model (per entry point)

### 📝 Contact form
- Card created in **🟡 Interested** stage (`interestedStage`, `/interest/i` ... actually
  the ghosted stage; confirm anchor in `_stage.js interestedStage`).
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

## Status
BUILT DORMANT 2026-06-26. To go live for GTA: (1) set `portal_entry_routing` config on the
GTA client row, (2) approve+enable ghosted + trial_followup automations, (3) turn OFF the
matching GHL "form filled" workflows. V2/V1.5 only; V1 untouched. Quiet-hours clamp can
push the 20-min nudge to the next morning if it lands outside 8am-9:30pm Toronto.

# Entry-point routing — form fill → stage + bot (the SPEC, 2026-06-26)

Zoran's decided model for how a website form-fill plugs into the sales pipeline +
who contacts them. **Build the wiring but keep it DORMANT** behind a flag until Zoran
turns OFF the GHL "form filled" workflows (today those own first-touch + pipeline -
see [[project_website_leads]]). Pairs with [[project_sales_crew_model]].

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

## Dormancy
- Gate behind a per-client flag (proposed `clients.ghl_kpi_config.portal_entry_routing`,
  default OFF). OFF = today's behavior (leads.js enrolls the GHL `ghl_workflow_id`,
  pipeline owned by GHL). ON = portal does the stage placement + ghosted / trial-timer
  enrollment AND skips the GHL workflow enroll (no double-touch). Zoran flips ON per
  academy when he turns OFF the matching GHL workflows.

## Build pieces (when greenlit)
1. **leads.js routing branch** (gated): on `form_type=contact` → place opp in Interested
   + `enrollContact('ghosted')`; on `form_type=free-trial` (no booking) → place opp in
   Responded + `enrollContact('trial_followup')`; on free-trial WITH booking → Scheduled
   Trial (booking path already moves there).
2. **`trial_followup` automation** = 1 step (wait 20 minutes → SMS nudge). Engine supports
   `minutes` (addWait, automations.js:55). Quiet-hours clamp applies (could delay past 20m
   outside 8am-9:30pm Toronto - acceptable).
3. **Exit triggers**: booking the trial → `exitEnrollment('trial_followup', reason:'booked')`
   + ensure stage = Scheduled Trial. Reply → already exits enrollments + moves to Responded
   (inbound-webhook, P6).
4. Stage placement uses `_stage.js` finders (interestedStage / respondedStage /
   scheduledTrialStage). Needs the academy OAuth token (calendar/opp writes).

## Status
SPEC only (2026-06-26). Nothing built yet. Ghosted automation steps exist + name
personalization is fixed (see [[project_sales_crew_model]]). V2/V1.5 only; V1 untouched.

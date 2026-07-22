# "Not flowing" panel + off-GHL trial dates

2026-07-22 (PR #1549). The client-portal safety net `_ccStuckCards` (the red
**"N not flowing - no agent, no automation, idle 3+ days"** panel in
`client-portal.html`) exempts any card whose booked trial is **still ahead**
(`if (o.trialDate) { if (!_plTrialInfo(o.trialDate).passed) continue; }`).

**Gotcha it hit:** on **off-GHL academies** (`pipeline_provider` /
`booking_provider = 'portal'`, e.g. BAM GTA, DETAIL Miami) the board's
`o.trialDate` was only filled from **GHL-era sources** in `api/ghl/pipelines.js`:
`website_leads.booked_slot`, GHL calendar appointments, GHL contact custom
fields. The **real current booking** lives in the portal's own `trial_bookings`
+ `schedule_slots` spine (scoped by `tenant_id` = client id), which nothing read.
So a **rebooked** trial (parent moved the date) kept reading the STALE
`website_leads.booked_slot`; that past date meant "trial ahead" never fired and
a lead with a real upcoming trial got flagged idle/stuck. Surfaced by Meg/Blake
Pappas (GTA) - flagged not-flowing with a BOOKED trial that same night.

**Fix:** new **step 4a** in `pipelines.js` - for portal-provider/portal-booking
academies, read `trial_bookings` + `schedule_slots` by `ghl_contact_id` and set
`o.trialDate` from the **newest non-cancelled booking's slot `start_time`**, as an
**authoritative override** of the step-4 website_leads date (rebooking = latest
intent wins). Cancelled bookings / cancelled slots skipped. Gated
`provider === 'portal' || booking_provider === 'portal'` → pure-GHL (V1) = a
byte-identical no-op. Board cache TTL is 30s so the live panel self-corrects fast.

Note: the **re-arm cron** ([[project_rearm_sweep]]) is NOT affected by this bug -
it skips scheduled-trial-STAGE leads by role, not by `trialDate`, so it already
left booked-trial leads alone. This was purely the client-side panel's exemption.

See also [[project_calendar_off_ghl]] · [[project_v2_sales_board]].

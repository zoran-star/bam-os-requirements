# "Trials today" count + the GHL calendar window gotcha (2026-06-29)

## ⚠️ GOTCHA: GHL `/calendars/events` leaks events PAST `endTime`
`GET /calendars/events?...&startTime=<ms>&endTime=<ms>` returns appointments whose
start is **after** the requested `endTime` (GHL ignores/loosely applies the upper
bound). So a "today" query (academy-TZ midnight→midnight) also returns TOMORROW's
appointments. **Always re-filter results by `new Date(ev.startTime).getTime()` being
within `[start, end)` yourself.** Don't trust GHL's window.

Symptom that found it: Home "trials today" showed **9** for BAM GTA when only **6**
were real (3 Group 1 @7pm + 3 Group 2 @8pm). GHL had also returned the next day's
2+1 = 3 extra. Verified live against GHL with the academy OAuth token.

## Fix (SHIPPED, PR #867)
`api/ghl/calendars-v15.js` — added the start-time window guard in BOTH:
- `action=trials-today` (the Home number) — the bug.
- `action=events` (the calendar grid) — same guard, for consistency.
Right calendars + timezone were already correct; only the window wasn't enforced.

## How Home "trials today" works (the authority)
`api/ghl/calendars-v15.js action=trials-today`: for each id in
`clients.ghl_kpi_config.booking_calendar_ids`, GET `/calendars/events` within
`todayBoundsMs(client.time_zone)` (academy-TZ midnight→midnight), skip `cancelled`,
**now also skip events whose startTime is outside today**, key by `contactId`.
GTA: `booking_calendar_ids = [Cmw4bCVBhexgi0Oi0Dkf (Group 1 Elem), G5y4QI0MsFq3159IhFU7
(Group 2 HS)]`; these MATCH GTA's `entry_points` type=calendar rows. TZ America/New_York.

## ⬜ FOLLOW-UP (not built): pipeline "trial today" glow ↔ Home parity
The Scheduled-Trial pipeline cards glow "trial today" via a DIFFERENT mechanism
(`pipelines.js` trialDate enrichment chain: website_leads.booked_slot → latest appt
in ±120d; `client-portal.html _plIsTrialToday` compares browser-local `new Date()`).
That drifts from Home (different date source, browser TZ, "latest appt" not "today").
**Agreed fix (Option A, not yet built):** on pipeline board load, call the SAME
`calendars-v15 action=trials-today` endpoint, build `Set(contactId)`, and flag a card
"today" iff `set.has(opp.contactId)` — one source of truth, guaranteed parity. The
window-bug fix above is the prerequisite (Home is now correct). `o.trialDate` stays
for display + post-trial-form gating; only the today-glow switches source.

## Creds note
GTA has NO `GHL_LOCATIONS_JSON` entry (OAuth, not PIT); `vercel env pull`'s
`SUPABASE_SERVICE_KEY` is INVALID (Vercel sensitive var). To hit GHL ad-hoc, pull the
short-lived `clients.ghl_access_token` (has calendars/events.readonly) via Supabase MCP.

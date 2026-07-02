# Creative Refresh Calendar (campaign asset update windows)

**Status: SCOPED 2026-07-02, not built.** Origin: BAM Digital Marketing call Jul 01 (Ximena: clients must keep updating ad creatives; Cam: calendar view, color-coded, staggered across weeks, click-to-nudge).

## The problem
Clients go stale on ad creatives. Ximena needs fresh assets monthly per client; today there is no system - she chases ad hoc. Fallback when a client has nothing new: they share existing organic posts for her to test as ads.

## Locked decisions (Cam, 2026-07-02)
- **Cadence: monthly, week-anchored.** Each client gets a `refresh_week` (1-4); their window = Monday-Sunday of that week each month. NOT day-staggered - the 7-day window IS the stagger; balance load by moving clients between weeks. Day-offset within week only if we ever pass ~30+ clients (schema already supports it via window_start/end dates).
- **UI: 4 week-lanes, one chip per client per month** (not a 31-day grid). Chip count per lane = creative-team capacity read. Statuses: upcoming (grey) / window open (blue) / submitted (green) / overdue (red). Current week highlighted + "now" pill. "Needs attention" filter = overdue + open-not-submitted only. Click chip -> side panel (last submission, linked ticket, nudge history, actions).
- **Nav: section pill INSIDE the Marketing tab** (MarketingView already has a section pill toggle) - NOT a new top-level nav tab. Option A chosen explicitly.
- **Nudge channels: Slack (client channel) + client portal banner.** No email/SMS (that's round-3 anyway). Slack via existing `clients.slack_channel_id` fire-and-forget pattern in `api/marketing.js`. Portal banner: "Your creative refresh window is open until <date>" linking into the submit flow.
- **Access: view wide, edit narrow.** Visibility rides `canSeeContent` (admin, scaling_manager, marketing_manager, marketing_executor, content_executor). `canEdit = admin || scaling_manager || marketing_manager` - executors see everything but the 3 action buttons (Nudge now / Mark received / Move to week) are hidden.
- **Primary users:** Ximena (knows when refresh is due) + Cam (manages creative production capacity).
- Styling: portal `tk.*` tokens (`src/tokens/tokens.js`) like every other view - light mode free.

## Data model (planned)
- `clients.refresh_week` int 1-4 (the stagger anchor)
- New table `creative_refresh_windows`: `client_id, month, window_start, window_end, status (upcoming/open/submitted/overdue/skipped), nudged_at, submitted_ticket_id`
- Cron auto-generates next month's rows from `refresh_week`
- Submitted detection: auto-flip when a `content_ticket`/`marketing_ticket` lands during the window + manual "Mark received" fallback

## Build phases
1. **Calendar + manual** (~1 session): week-lane view as Marketing section pill, side panel, manual nudge, refresh_week assignment
2. **Automation** (~0.5): cron generates windows, auto Slack nudge on open, overdue flip, extend `contentDeadlinesDigestCron()` staff digest
3. **Client side** (~0.5): portal banner + submit entry linking the ticket back to the window

## Explicitly OUT of v1
Drag-drop rescheduling (dropdown move is enough), per-client cadences (all monthly), performance data on the calendar, and the "monthly winners newsletter" idea from the same call - that is a SEPARATE future build, do not merge scopes.

## Gates
V1.5/V2 clients only (standard hard rule - V1 untouched). Related: [[project_marketing_content_flow]], [[project_organic_content]].

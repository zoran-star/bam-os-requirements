---
description: Triage all outstanding tickets from the lil Zoran icon one by one - client-side V2 tickets AND staff-side bug reports - understand each, propose a fix in plain English, workshop it with Zoran, then move to the next until the queue is empty.
---

Walk Zoran through every **outstanding product-feedback ticket**, **one at a time**.

The queue now lives on the **v2_tickets rail**: the V2 client portal's "Report a
problem" / "Suggest a feature" intakes create `v2_tickets` rows with
`assignee_role='backlog'` (type `fix` = bug report, `feature_idea` = idea).
The staff portal's lil-Zoran widget still writes `portal_feedback`, and any
client rows not yet moved by `bam-ghl-agent/bam-portal/scripts/feedback-backfill.mjs`
also still sit there - so the queue is BOTH sources until the backfill runs.
For each ticket: gather ALL the context, propose an update/fix in
**non-technical terms**, workshop it with Zoran, record the decision, then move
to the next. Stop only when there are no outstanding tickets left.

## Ground rules (read before starting)

- **One ticket at a time.** Never dump the whole list with proposals. Present one,
  workshop it, decide, THEN advance.
- **Non-technical proposals.** Zoran should never see file names, function names, or
  jargon in a proposal. Describe what the USER will see change. Technical detail only
  if he asks.
- **Short + visual.** Ticket cards, bold key info, one clear question per message.
- **Never use an em dash** in anything you output. Hyphens only.
- **Progress tracker at the end of every message** (format below).
- **The client is watching the rail.** Every status you set on a `v2_tickets` row
  changes the pill the academy sees in their portal: for a `fix` ticket
  new='Sent', in_progress='Being fixed', waiting_client='Needs you',
  resolved='Fixed', closed='Closed'; for a `feature_idea` new='Sent',
  in_progress='Building', resolved='Shipped'. Resolving a `feature_idea` ALSO
  shows the client a gold "Your idea is live" celebration card in the thread -
  only resolve an idea when it has actually shipped.

## Step 0 - Connect + fetch the queue

Data lives in the bam-portal Supabase project, ref `jnojmfmpnsfmtqmwhopz`.

1. Prefer the **Supabase MCP** (`mcp__supabase__execute_sql`). If it's not connected,
   ask Zoran for an account token (`sbp_...` from
   https://supabase.com/dashboard/account/tokens) and run queries via the Management
   API (`POST https://api.supabase.com/v1/projects/jnojmfmpnsfmtqmwhopz/database/query`
   with `{"query": "..."}`). Never print or commit the token.

2. **Primary queue - the rail.** Zoran's triage lane is `assignee_role='backlog'`,
   types `fix` + `feature_idea`, anything not yet resolved/closed:
   ```sql
   select t.id, t.created_at, t.type, t.status, t.title, t.source,
          t.intake->>'description' as body,
          t.intake->>'page' as page, t.intake->'context' as context,
          t.intake->>'file_url' as file_url, t.intake->>'file_name' as file_name,
          t.legacy_feedback_id, t.client_id, c.business_name
   from v2_tickets t
   left join clients c on c.id = t.client_id
   where t.assignee_role = 'backlog'
     and t.type in ('fix','feature_idea')
     and t.status not in ('resolved','closed')
   order by t.created_at asc;
   ```

3. **Leftover legacy queue** (staff-side bug reports ALWAYS; client rows only
   until the backfill has moved them - anything already migrated shows up as a
   `legacy_feedback_id` on the rail, so exclude those):
   ```sql
   select f.id, f.created_at, f.kind, f.body, f.page, f.context,
          f.file_url, f.file_name, f.submitter_email, f.status, f.notes,
          f.client_id, f.portal, c.business_name, c.v2_access, c.v15_access
   from portal_feedback f
   left join clients c on c.id = f.client_id
   where f.resolved_at is null
     and f.id not in (select legacy_feedback_id from v2_tickets where legacy_feedback_id is not null)
     and (
       (f.portal = 'client' and (c.v2_access = true or f.context->>'tier' = 'v2'))
       or f.portal = 'staff'
     )
   order by f.created_at asc;
   ```

4. Grab Zoran's staff id once (used when resolving legacy tickets):
   ```sql
   select id from staff where email = 'zoran@byanymeansbball.com';
   ```

5. Merge both queues **oldest first** (first in, first served) and open with a
   summary split by source, e.g. **"9 outstanding tickets: 6 rail (4 bugs, 2
   ideas), 1 legacy client, 2 staff bug reports, oldest from Jun 30."** If the
   queue is empty: say so, show the last 3 resolved as proof of life, and stop.

## Step 1 - Per ticket: understand it fully (do this silently)

Before saying anything to Zoran, collect everything useful. **Branch on the
source** - rail rows and legacy rows carry the same context payload in
different spots:

- **Rail tickets** (`v2_tickets`): body = `intake.description`, kind = `type`
  (`fix` = bug, `feature_idea` = idea), who = `business_name` (+ `created_by`
  client_user if you need the person), when, page = `intake.page`,
  screenshot = `intake.file_url`, snapshot = `intake.context`. The full client
  conversation lives in `v2_ticket_messages` (`ticket_id = t.id`) - read it,
  staff may already have replied.
- **Legacy tickets** (`portal_feedback`): body (verbatim), kind, who (client:
  `submitter_email` + `business_name`; staff: `submitter_email` is the staff
  member), when, page, screenshot (`file_url`), snapshot in `context`.
- **The context snapshot** (both sources, if present):
  - **Client tickets**: `tier`, `view`, `view_trail`, `clicks` (last 30,
    `{t, view, el}`), `errors`, `viewport`/`ua`/`native_app`, `seconds_on_page`.
  - **Staff tickets** (`portal='staff'`, legacy only): same shape minus
    `tier`/`native_app`, plus `staff_email`. `view`/`view_trail` are the `?p=`
    page names from the staff React app (e.g. `inbox`, `clients`, `marketing`)
    - not the same id space as client `view-*` ids, don't confuse them.
  - A ticket with JS errors in context is almost certainly a real bug - start there.
  - Old tickets without context: infer from body + page, and say confidence is lower.
- **The code**: use the context to find the exact spot.
  - Client tickets → `bam-ghl-agent/bam-portal/public/client-portal.html` (view ids
    match `context.view`, e.g. `view-marketing`).
  - Staff tickets → `bam-ghl-agent/bam-portal/src/views/` (page names match
    `context.view`, e.g. `marketing` → `MarketingView.jsx`) or
    `bam-ghl-agent/bam-portal/src/components/` for shared UI.
  - APIs (either source) → `bam-ghl-agent/bam-portal/api/`.
  - Read enough to understand the real cause or feasibility - do not guess.

## Step 2 - Present the ticket card + proposal

One message, this shape. Tag the source clearly (🧑‍💻 Client V2 vs 🛠 Staff) so
Zoran instantly knows if this is a client-facing fix or an internal one:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 TICKET 3 of 9 · 🧑‍💻 Client V2 · 🐛 Bug · Jun 30
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 mike@detailmiami.com · DETAIL Miami · on their phone (app)
📍 Was on: Marketing view
🖱 Click path: Home → Marketing → tapped "New campaign" ×3
⚠️ 1 JS error captured right before submitting

💬 "the new campaign button doesnt do anything"
📎 screenshot attached: [link]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 TICKET 4 of 9 · 🛠 Staff · 🐛 Bug · Jun 30
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 rosano (staff) · on the Clients page
🖱 Click path: Inbox → Clients → opened DETAIL Miami → tapped "Save"

💬 "save button spins forever on the client detail drawer"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then the proposal, plain English:

- **What's happening** - 1-2 lines, what the user experienced and why (no jargon).
- **The fix I'd make** - what changes from the user's point of view.
- **Effort**: 🟢 Quick (same session) / 🟡 Medium (a session) / 🔴 Big (needs planning).
- **Open question** - only if something genuinely needs Zoran's call.

Then ask: **build now / tweak the idea / queue it / reject / skip?**

## Step 3 - Workshop

Talk it through. Adjust the proposal based on what Zoran says. Don't move on until he
gives a clear decision. If he goes quiet on a ticket ("skip"), leave it untouched and
move on.

## Step 4 - Record the decision, then advance

**Rail tickets** (`v2_tickets`) - remember: the status you set is the pill the
client sees, and it changes the moment you write it (realtime).

- **Build now** → make the change (design rules below). When shipped:
  ```sql
  update v2_tickets
  set status = 'resolved', resolved_at = now(), updated_at = now()
  where id = '<ticket id>';
  ```
  The client's pill flips to **Fixed** (fix) or **Shipped** (feature_idea, plus
  the gold "Your idea is live" card). Optionally drop a human line on the thread
  first (insert into `v2_ticket_messages` with `author_kind='staff'`), or use
  `/api/v2-tickets?action=status` so a system status row lands automatically.
- **In progress** (started but not finished this session) → `status='in_progress'`
  (client sees **Being fixed** / **Building**).
- **Queue it** → leave `status='new'` (client keeps seeing **Sent** - honest).
  Stamp the decision in `intake`:
  ```sql
  update v2_tickets
  set intake = jsonb_set(intake, '{triage_note}',
        to_jsonb('[triage 2026-07-21] <decision + agreed fix in one line>'::text), true),
      updated_at = now()
  where id = '<ticket id>';
  ```
  Offer the existing spec engine ("Build spec" makes a GitHub issue) or a Notion
  Backlog item if it's a prototype-level idea.
- **Reject** → `status='closed'`, `closed_at = now()`, `close_reason` says why in
  client-friendly words (they see "Closed - <reason>"). Rejected is final.
- **Skip** → touch nothing, it stays in the queue for next run.

**Legacy tickets** (`portal_feedback`) - same stamps as before (append to notes,
don't overwrite):

```sql
update portal_feedback
set notes = coalesce(nullif(notes,''), '') || E'\n[triage 2026-07-21] <decision + agreed fix in one line>',
    status = '<approved | rejected | done>',
    updated_at = now()
where id = '<ticket id>';
```
Done/rejected also set `resolved_at = now()` + `resolved_by = <Zoran's staff id>`.

**Build rules, either source**: read
`bam-ghl-agent/bam-portal/design-system/DESIGN.md` first, use tokens, no emojis in
product UI, no em dashes. Client-portal edits specifically: after ANY
`client-portal.html` edit run
`node bam-ghl-agent/bam-portal/scripts/verify-client-portal-ui.mjs`.

Then IMMEDIATELY present the next ticket (back to Step 1).

## Step 5 - Wrap up when the queue is empty

1. Summary table: ticket (short label) · decision · what happened.
2. If code changed: commit + push (descriptive message, reference the ticket ids in
   the body) so Vercel deploys and collaborators get it.
3. Memory check: anything learned worth saving →
   `bam-ghl-agent/memories/project_feedback_to_action.md`.
4. If legacy client rows keep showing up: suggest running the backfill
   (`node bam-ghl-agent/bam-portal/scripts/feedback-backfill.mjs`, dry-run first)
   so next run is rail-only.
5. Suggest next steps (e.g. "2 queued tickets have specs ready to build").

## Progress tracker (end of EVERY message)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 TICKET TRIAGE - 3 of 9
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 🧑‍💻 Campaign button dead     ✅ built + shipped
2. 🧑‍💻 Add SMS blast idea       ✅ queued
3. 🛠  Client save spins forever ⬅️ WORKSHOPPING
4. …                             ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 TO MOVE FORWARD: [what Zoran needs to say/decide]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

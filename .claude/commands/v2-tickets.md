---
description: Triage all outstanding tickets from the lil Zoran icon one by one - client-side V2 tickets AND staff-side bug reports - understand each, propose a fix in plain English, workshop it with Zoran, then move to the next until the queue is empty.
---

Walk Zoran through every **outstanding ticket** submitted via the feedback widget
(the lil Zoran icon - lives on BOTH the client portal and the staff portal, same
table `portal_feedback`), **one at a time**. Covers client-side V2 feature tickets
AND staff-side internal bug reports in one combined queue. For each ticket: gather
ALL the context, propose an update/fix in **non-technical terms**, workshop it with
Zoran, record the decision, then move to the next. Stop only when there are no
outstanding tickets left.

## Ground rules (read before starting)

- **One ticket at a time.** Never dump the whole list with proposals. Present one,
  workshop it, decide, THEN advance.
- **Non-technical proposals.** Zoran should never see file names, function names, or
  jargon in a proposal. Describe what the USER will see change. Technical detail only
  if he asks.
- **Short + visual.** Ticket cards, bold key info, one clear question per message.
- **Never use an em dash** in anything you output. Hyphens only.
- **Progress tracker at the end of every message** (format below).

## Step 0 - Connect + fetch the queue

Data lives in the bam-portal Supabase project, ref `jnojmfmpnsfmtqmwhopz`.

1. Prefer the **Supabase MCP** (`mcp__supabase__execute_sql`). If it's not connected,
   ask Zoran for an account token (`sbp_...` from
   https://supabase.com/dashboard/account/tokens) and run queries via the Management
   API (`POST https://api.supabase.com/v1/projects/jnojmfmpnsfmtqmwhopz/database/query`
   with `{"query": "..."}`). Never print or commit the token.

2. Make sure the context column exists (idempotent, safe to always run):
   ```sql
   alter table public.portal_feedback add column if not exists context jsonb;
   ```

3. Fetch outstanding tickets from BOTH portals, **oldest first** (first in, first
   served). Client-side is scoped to V2 (tier from `clients.v2_access` or the
   context snapshot); staff-side has no tier gate - all open staff feedback counts:
   ```sql
   select f.id, f.created_at, f.kind, f.body, f.page, f.context,
          f.file_url, f.file_name, f.submitter_email, f.status, f.notes,
          f.client_id, f.portal, c.business_name, c.v2_access, c.v15_access
   from portal_feedback f
   left join clients c on c.id = f.client_id
   where f.resolved_at is null
     and (
       (f.portal = 'client' and (c.v2_access = true or f.context->>'tier' = 'v2'))
       or f.portal = 'staff'
     )
   order by f.created_at asc;
   ```

4. Grab Zoran's staff id once (used when resolving tickets):
   ```sql
   select id from staff where email = 'zoran@byanymeansbball.com';
   ```

5. Open with a queue summary, split by source, e.g. **"9 outstanding tickets: 7
   client V2 (5 bugs, 2 features), 2 staff bug reports, oldest from Jun 30."** If
   the queue is empty: say so, show the last 3 resolved as proof of life, and stop.

## Step 1 - Per ticket: understand it fully (do this silently)

Before saying anything to Zoran, collect everything useful. **Branch on `f.portal`**
- the two sources carry different context shapes:

- **The ticket row**: body (verbatim), kind, who (client: `submitter_email` +
  `business_name`; staff: `submitter_email` is the staff member), when, page,
  screenshot (`file_url`).
- **The context snapshot** (`context` jsonb, if present):
  - **Client tickets** (`portal='client'`): `tier`, `view`, `view_trail`, `clicks`
    (last 30, `{t, view, el}`), `errors`, `viewport`/`ua`/`native_app`,
    `seconds_on_page`.
  - **Staff tickets** (`portal='staff'`): same shape minus `tier`/`native_app`, plus
    `staff_email`. `view`/`view_trail` are the `?p=` page names from the staff React
    app (e.g. `inbox`, `clients`, `marketing`) - not the same id space as client
    `view-*` ids, don't confuse them.
  - A ticket with JS errors in context is almost certainly a real bug - start there.
  - Older tickets (client: before 2026-07-08; staff: before the staff-widget parity
    shipped same day) won't have context. Infer from body + page, and say
    confidence is lower.
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

Always stamp the decision on the ticket so nothing is re-litigated next run
(append to notes, don't overwrite):

```sql
update portal_feedback
set notes = coalesce(nullif(notes,''), '') || E'\n[triage 2026-07-08] <decision + agreed fix in one line>',
    status = '<approved | rejected | done>',
    updated_at = now()
where id = '<ticket id>';
```

- **Build now** → make the change. Either source: read
  `bam-ghl-agent/bam-portal/design-system/DESIGN.md` first, use tokens, no emojis in
  product UI, no em dashes. Client-portal edits specifically: after ANY
  `client-portal.html` edit run
  `node bam-ghl-agent/bam-portal/scripts/verify-client-portal-ui.mjs`. When shipped:
  `status='done'`, set `resolved_at = now()` and `resolved_by = <Zoran's staff id>`.
- **Queue it** → `status='approved'`, leave `resolved_at` null. Offer the existing
  spec engine ("Build spec" makes a GitHub issue) or a Notion Backlog item if it's a
  prototype-level idea.
- **Reject** → `status='rejected'`, `resolved_at = now()`, `resolved_by = <staff id>`,
  note says why. Rejected is final.
- **Skip** → touch nothing, it stays in the queue for next run.

Then IMMEDIATELY present the next ticket (back to Step 1).

## Step 5 - Wrap up when the queue is empty

1. Summary table: ticket (short label) · decision · what happened.
2. If code changed: commit + push (descriptive message, reference the ticket ids in
   the body) so Vercel deploys and collaborators get it.
3. Memory check: anything learned worth saving →
   `bam-ghl-agent/memories/project_feedback_to_action.md`.
4. Suggest next steps (e.g. "2 queued tickets have specs ready to build").

## Progress tracker (end of EVERY message)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 TICKET TRIAGE — 3 of 9
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 🧑‍💻 Campaign button dead     ✅ built + shipped
2. 🧑‍💻 Add SMS blast idea       ✅ queued
3. 🛠  Client save spins forever ⬅️ WORKSHOPPING
4. …                             ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 TO MOVE FORWARD: [what Zoran needs to say/decide]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

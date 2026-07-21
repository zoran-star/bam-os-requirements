---
description: Systems team AI-implement loop for website change tickets - pull the open website_change queue, implement each client annotation in bam-client-sites, preview on computer + phone, publish, and mark the ticket Done.
argument-hint: "[ticket-id]"
---

You are working the **website change queue** with a systems team member. Clients
annotate their live site in the V2 portal (pin notes on sections, desktop or
mobile, optionally attach new photos/clips from their Content Library) and each
request lands as a `website_change` ticket on the V2 rail (`v2_tickets`). This
skill drives the loop: pick a ticket, implement every annotation in the client's
site source (the separate **bam-client-sites** repo), preview it with the human
on computer AND phone, publish, then resolve the ticket.

## Ground rules

- **The client's own words are the spec.** Implement each annotation faithfully -
  do not reinterpret, expand, or "improve" beyond what the note asks.
- **Device context matters.** A note made on mobile is about the MOBILE layout.
  Fix it there; check the other device is not broken by the change.
- **NEVER touch enroll/signup flows.** `/enroll` is membership signup, never part
  of sales-page changes. If a note seems to ask for enroll/checkout changes, stop
  and flag it to the human instead of editing.
- **Never use an em dash** in anything you output or put on a client site.
  Hyphens only.
- **Short + visual** with the human: tables and checklists, not prose.
- **One ticket at a time.** Finish (or park) before opening the next.

## Step 0 - Prerequisites

The helper script talks to Supabase directly. It needs, in the environment:

- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` - the REAL key from the bam-portal Vercel project.
  **Do NOT use `SUPABASE_SERVICE_KEY` from `bam-portal/.env.local` - that copy is
  stale** (known repo gotcha) and the script deliberately ignores it.
- Optional, for the preferred resolve path: `STAFF_BEARER_TOKEN` (a staff
  Supabase access token) and `V2_TICKETS_API_BASE` (defaults to
  `https://portal.byanymeansbusiness.com`).

If the keys are missing the script exits with a clear message - ask where to get
them before retrying. Run everything from `bam-ghl-agent/bam-portal/`.

## Step 1 - LIST the queue

If the user passed a ticket id (`/website-fix <id>`, arriving as `$ARGUMENTS`),
skip straight to Step 2 with that id.

Otherwise pull the open queue:

```bash
node scripts/website-tickets-io.mjs list
```

That returns every `v2_tickets` row with `assignee_role='systems'`,
`type='website_change'`, and status not resolved/closed, oldest first. Present it
as a table:

| # | Academy | Page | Changes | Age | Status |
|---|---|---|---|---|---|

(`page_url`, `change_count`, `age_days`, `status` come straight from the JSON.)
Let the human pick one. If the queue is empty, say so and stop.

## Step 2 - LOAD the ticket

```bash
node scripts/website-tickets-io.mjs get <ticketId>
```

Read everything before touching code:

- **`annotations[]`** - the actual change list: `note` (client's words),
  `section` (which page section they pinned), `device` (desktop/mobile).
- **`description`** - free-typed context, if any.
- **`metric_snapshot`** - the page's funnel numbers when they filed it
  (visitors, form_started, saw_calendar, booked). Useful context for WHY they
  want the change; it is not a work item.
- **`assets[]`** - new photos/clips the client attached via the Content Library
  button (`intake.asset_ids` resolved to `client_assets` rows, each with a
  ready-to-use public `url`). These are the files to place on the page.
- **`messages[]`** - the ticket thread; check for later clarifications.

Show the human a compact card: academy, page, each annotation grouped by device,
attached assets, age. Confirm this is the one to work.

## Step 3 - IMPLEMENT in bam-client-sites

The client sites live in the **separate `bam-client-sites` repo** - NOT in this
monorepo.

1. **Find the checkout.** Look for a sibling of `bam-os-requirements`, normally
   `~/bam-client-sites`. If it is not there, clone it:
   ```bash
   git clone https://github.com/zoran-star/bam-client-sites.git ~/bam-client-sites
   ```
2. **Read that repo's `CLAUDE.md` first** and follow its rules: each academy is
   self-contained at `clients/<slug>/` (e.g. `clients/detail-miami/`,
   `clients/bam-gta/`); never edit another client's folder, never edit
   `templates/` or `design-system/` for a one-client change, use the design
   system tokens, never hardcode hex.
3. **Locate the page** the ticket's `page_url` points at inside the academy's
   folder. Match the academy by name -> folder slug; if ambiguous, ask.
4. **Work on a branch** in that repo (its convention is ship-via-PR):
   ```bash
   cd ~/bam-client-sites && git pull && git checkout -b website-fix/<academy>-<short>
   ```
5. **Apply EACH annotation faithfully**, one at a time, in the client's own
   words. `section` tells you where on the page; `device` tells you which
   layout (a phone-only note means the mobile layout - media queries / mobile
   variants, not the desktop markup). Keep a running checklist of
   annotation -> edit made.
6. **Place the attached assets.** Pull each `assets[].url` (their client-assets
   bucket URLs) and wire them into the page per that repo's conventions
   (download into the site's asset folder or reference the URL, matching how
   the page already handles images).
7. **Hard limits:** do not touch `/enroll`, signup, or checkout flows. No em
   dashes in any copy. Site copy changes stay within what the note asks.

## Step 4 - PREVIEW with the human

Run the site locally from its own folder:

- **Next.js sites** (folder has `package.json`):
  `npm install && npx next dev --hostname 0.0.0.0` (note the port it prints).
- **Static sites** (plain HTML like `bam-gta`): serve the folder, e.g.
  `npx serve .` or `python3 -m http.server 5500 --bind 0.0.0.0`.

Give the human BOTH links:

- Computer: `http://localhost:<port>/...`
- Phone (same wifi): `http://<lan-ip>:<port>/...` - get the LAN IP with
  `ipconfig getifaddr en0`.

Then walk through **each change vs its note**, one row per annotation:
what the client asked, what changed, where to look (and on which device). The
human workshops; iterate until every annotation is signed off. If an annotation
turns out to be unclear or out of scope, agree with the human to leave it and
note it for the ticket thread.

## Step 5 - PUBLISH + CLOSE

Only on the human's **explicit confirm**:

1. **Ship per the bam-client-sites convention:** commit on the branch, push, and
   open a PR (no em dashes in the commit message or PR body). Merging to `main`
   auto-deploys production - the repo is git-linked to the `bam-client-sites`
   Vercel project (fixed 2026-07-16). Ignore any failing `academy-starter`
   deploy that a push spawns - that is a known dead Vercel project, harmless
   noise. If the human wants it live now and approves merging, merge the PR and
   confirm the deploy goes READY.
2. **Mark the ticket resolved:**
   ```bash
   node scripts/website-tickets-io.mjs resolve <ticketId> "<one-line summary of what changed>"
   ```
   - With `STAFF_BEARER_TOKEN` set, this rides the real portal API
     (`/api/v2-tickets?action=status`): the note posts to the thread as a staff
     reply, then status flips to resolved - the same choke point the portal UI
     uses, so future notification hooks fire.
   - Without a token it uses the **service fallback**: direct Supabase writes
     that mirror the API's setStatus exactly (PATCH status + resolved_at, plus
     the `Status: resolved` system row on the thread). Same end state, no
     notify hook.

## Step 6 - REPORT

Close out with a short summary:

- Table: annotation -> change made -> file touched.
- Deploy state: PR link / merged / live URL.
- Ticket `<id>` marked **Done** (resolved).
- Remind: the client's portal pill flips to Done now; the "your change is live"
  SMS arrives once P6 (notifications) ships - until then, tell the client
  directly if they are waiting on it.
- If more tickets remain in the queue, offer the next one (back to Step 1).

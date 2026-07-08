# Website Leads — client-site forms → portal → GHL

## What it is
Public endpoint `bam-portal/api/website/leads.js` receives form submissions
from client websites (bam-client-sites repo). **Save-first architecture**:
our DB is the source of truth, GHL is a mirror we can unplug per client.

```
client site form
  → POST /api/website/leads  { client_id, form_type, name, email, phone, fields, source_url }
  → 1. SAVE    website_leads row (always — every submission, no dedupe; rows = form fills)
  → 2. DELIVER GHL upsert contact
               tags: website-inquiry + "<form type> form filled" + entry_points row tags
               + NOTE on the contact with the message text
               + conversation entry (inbox presence; thread text needs a
                 conversation provider — not registered yet, so notes carry the message)
               + open opportunity in the pipeline/stage from the entry_points row
                 (names resolved to GHL IDs at runtime, 5-min cache; skipped if the
                 contact already has an open opportunity in that pipeline)
  → 3. RECEIPT stamp row: ghl_contact_id + ghl_synced_at, or ghl_error
```

## Booking (free-trial calendars, Jun 2026)
- `GET /api/website/availability?client_id&calendar&days` — public free-slots
  proxy (same CORS as leads). Only calendars exposed as `entry_points` rows
  (type calendar) are readable. Uses the academy OAuth token w/ auto-refresh
  (static location keys lack calendar scopes); 60s edge cache.
- `POST /api/website/leads` accepts optional `booking { calendar_id, start }`
  → creates the real GHL appointment after contact upsert (GHL handles
  confirmations/reminders). Failure degrades: lead saved, response carries
  `appointment: booked|failed`, site shows "we'll confirm by email".
- GTA free-trial page: AGE question (5 to 19) routes the calendar — 13 and
  under → Group 1 (`Cmw4bCVBhexgi0Oi0Dkf`), 14+ → Group 2
  (`G5y4QI0MsFq3159IhFU7`). Sends athlete_age (→ GHL "Athlete's Age"
  numeric field) + group label. Grade was dropped 2026-06-12 (GHL grade
  field only had options 5-9).
- **Pipeline ownership = the GHL workflow, NOT the portal (decided 2026-06-18).**
  For GTA's website **free-trial** and **contact** forms, `entry_points.pipeline_name`
  + `stage_name` were set to NULL, so the portal no longer creates/places an
  opportunity for them. The form's GHL workflow ("trial form filled in" /
  "contact form filled in") owns the pipeline entirely (create + stage moves).
  Reason: V1.5 = integrate with GHL's existing automations, and having both the
  portal AND the workflow add to the pipeline risked duplicate cards (the old
  design relied on the workflow's create/update-opportunity matching the portal's
  card by plain contact name — fragile). Portal still: saves the lead, upserts the
  contact, adds tags, posts the note/inbox entry, and ENROLLS the contact into the
  form's `ghl_workflow_id`. **Assumes those workflows create the pipeline card
  themselves** — if a workflow only MOVES an existing card, leads won't appear in
  the pipeline.
- **Calendars also workflow-owned now (2026-06-18).** `entry_points` type=calendar
  (both GTA booking calendars) had pipeline_name/stage_name set to NULL too, so the
  portal no longer advances the pipeline on booking. Booking still (a) CREATES the
  GHL appointment and (b) enrolls the "free trial booked" workflow — only the
  portal's stage-advance was removed (leads.js ~line 390, gated on
  pipeline_name+stage_name). The "free trial booked" workflow owns the stage move to
  "scheduled trial". Net: the portal places ZERO opportunities for GTA — every
  pipeline action (create + stage moves + WON) lives in the GHL workflows. V1.5.

## Booking Calendars panel (portal-managed availability, Jun 2026)
- Client portal → Calendar tab → "Booking Calendars" section (above the
  weekly schedule): per-calendar editor for weekly hours, spots per session
  (appoinmentPerSlot), and blocked dates (GHL date overrides w/ empty hours),
  plus upcoming bookings (14 days) and "+ New calendar" (creates the GHL
  event calendar AND its entry_points row).
- API: GET/PATCH/POST /api/website/calendars?client_id= (staff or
  client_users auth; academy OAuth token w/ auto-refresh). Only calendars
  exposed as entry_points are listable/editable.

## Offer scoping (decided 2026-06-12)
- **The OFFER is the organizing unit**: each offer (training, team/ADAPT, …)
  gets its own pipeline, website funnel, entry points, calendars, agents,
  member management, and KPIs. `entry_points.offer_id` → `offers(id)`;
  GTA's Training-offer entry points (`52a6285c-…`) = 2 website forms +
  2 booking calendars (the 2 legacy GHL forms were deleted 2026-07-08,
  migration `20260708170000_delete_gta_ghl_entry_points.sql`).
- Client portal "Pipelines" page renamed **Sales** — currently the Training
  offer's sales page; offer switcher comes when offer #2 goes live.
- NEXT (discussed, not built): KPI strip on the Sales page — Leads → Trials
  booked → Showed → Joined with step conversions, + speed-to-book and
  in-nudges count. Open Qs for Zoran: exact stages, time window, and where
  showed/no-show truth lives (GHL appointment status?).

## Entry Points (lead routing layer, Jun 2026)
- **`entry_points` table**: one row per place leads enter an academy —
  type ∈ website-form | ghl-form | calendar | funnel, key (form_type or GHL id),
  label, tags[], pipeline_name, stage_name. "Connected" = pipeline+stage set.
- **API**: GET/PATCH `/api/website/entry-points?client_id=` (staff or
  client_users JWT auth, same pattern as ghl/pipelines.js).
- **UI**: client portal → Pipelines view → Entry Points rail (left of the
  board). Green card = connected (shows pipeline → stage), dashed = not
  connected; click opens the **Entry Point Set Up** wizard (pipeline/stage
  dropdowns from live GHL data, tag chips, save/disconnect).
- Only **website-form** rows are enforced by the leads API; ghl-form/calendar
  rows are standardized reference config (enforce via GHL workflows for now).
- BAM GTA has 4 live: website contact, website free-trial, 2 booking
  calendars (+ ADAPT intake, separate offer). The 2 legacy GHL-form rows
  were deleted 2026-07-08 (never connected, V2 landing pages bypass GHL forms).
- This is the onboarding primitive for V2: new academy = seed entry points,
  owner maps them in the wizard; off-GHL migration = repoint destinations.

## Key decisions (Jun 2026)
- **Save-first, not GHL-first.** Lead history must live in our system so
  migrating an academy off GHL is per-client "stop syncing", and lead counting
  comes from `website_leads` across all client sites (one dashboard).
- **CORS allow-list lives in `clients.allowed_domains`** (text[] of bare
  domains, e.g. `{byanymeansbball.com, bam-gta.vercel.app}`). Onboarding a new
  client site = update that row, no code change. 60s in-memory cache.
  Localhost dev origins stay hardcoded in the file.
- **GHL contact via `POST /contacts/upsert`**, NOT search-then-create — GHL's
  duplicate prevention rejects the create when the email search misses
  ("This location does not allow duplicated contacts"). Upsert matches on
  email/phone server-side.
- These website leads do NOT appear in GHL's Form Submissions page — GHL
  automations must trigger on **tag added: website-inquiry**, not "form
  submitted".

## Requirements per client
- `clients.allowed_domains` contains the site's domain(s)
- `clients.ghl_kpi_config.ghl_location` = location name present in
  `GHL_LOCATIONS_JSON` env, and `clients.ghl_location_id` set
- Without GHL config the lead still saves (`ghl: "not-configured"`)

## Wired sites (bam-client-sites repo)
- by-any-means → client `aad50450-…` (contact.html inline script)
- bam-gta → client `39875f07-…` (`gta/shared.jsx` submitLead(); contact +
  free-trial forms; free-trial sends requested_date/requested_time in fields)

## When to update this note
- Endpoint moves or response shape changes
- A new client site is wired (add to the list above)
- The GHL sync behavior changes (tags, conversation posting, upsert)
- A retry mechanism for `ghl_error` rows is added (doesn't exist yet)

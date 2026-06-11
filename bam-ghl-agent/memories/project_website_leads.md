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
- GTA free-trial page: grade question routes Grade 5 to 8 → Group 1
  (`Cmw4bCVBhexgi0Oi0Dkf`), Grade 9 to 12 → Group 2 (`G5y4QI0MsFq3159IhFU7`).

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
- BAM GTA seeded with 6: website contact, website free-trial, 2 GHL forms,
  2 booking calendars.
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

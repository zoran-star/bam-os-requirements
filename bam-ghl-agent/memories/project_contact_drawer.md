# Contact drawer (V1.5/V2) — what it shows + the stub-seed gotcha

`client-portal.html` `_cdBody()` + `_contactsOpenDrawer()`. Opened from the Contacts
list, and from Hawkeye card names / automations people-list / voicemail via
`_autoOpenContact(contactId, name)`. Contacts nav is `data-feature="v15"` → **V1 never
sees this drawer**, so drawer work is V1.5/V2-only by construction.

## ⚠️ The stub-seed gotcha (fixed 2026-07-11)
`_autoOpenContact` seeds a **stub** row `{ghl_contact_id, name, email:null, phone:null}`
then opens the drawer. The drawer fetches the full GHL contact into `_CDRAWER.ghl`
(that's what the CONTACT block renders), but the **composer, Stripe lookup, and
SMS/Email default read `_CDRAWER.contact`** (the stub). Result before the fix: phone +
email showed up top yet "No phone or email on file" + "No Stripe customer matched"
below. Fix = after the fetch, backfill the stub with `_CDRAWER.ghl` name/email/phone
(fills blanks only) and recompute `msgType`. If you add anything that reads
`_CDRAWER.contact`, remember it may be a stub unless backfilled.

## Sections (top → bottom) and their data sources
- **Contact / Tags / Call in GHL** — `_CDRAWER.ghl` (`/api/ghl/calendars-v15?action=contact`)
- **Lead** (`#cd-lead`, `_cdRenderLead`) — athlete name+age + last trial + coach + every
  other captured field.
- **Journey** (`#cd-journey`, `_cdRenderJourney`) — created → trial booked → showed/no-show →
  good fit/not-a-fit (+coach) → won/lost.
- **Agent memory** (`#cd-memory`, `_cdLoadMemory`) — post_trial facts + editable team notes
  (`/api/agent-contact-notes`; notes feed the sales agent's prompt).
- **Conversation** (`#cd-thread`, `_cdLoadThread`/`_cdRenderThread`) — read-only history via
  `/api/ghl/inbox`, reuses the shared `.ib-msg*` bubbles. Composer below sends.
- **Billing (Stripe)** — `/api/stripe/contact` matched by ghl_contact_id/email/phone.

## Shared-context render model (Lead + Journey)
Lead + Journey both paint from `_CDRAWER.ctx` and are re-rendered by whichever loader
resolves. `ctx` is seeded synchronously from `_cdFindOpp(contactId)` (the pipeline opp in
`_PL_DATA`, only present if the Pipeline tab was opened this session), then filled by three
async loaders that each call `_cdRenderLead()` + `_cdRenderJourney()`:
- `_cdLoadMemory` → `ctx.postTrial` (showed/fit) + coach fallback (`post_trial.trainer`)
- `_cdLoadLeadDetail` → `/api/ghl/contact-detail` custom fields → athlete/age/other fields
  + a "free trial date" custom field fallback
- `_cdLoadTrialCoach` → **`GET /api/ghl/calendars-v15?action=contact-trial&id=<cid>`** — the
  per-contact trial date + coach so they show **even when the pipeline was never loaded**.
  Server action is **Supabase-only + provider-agnostic** (runs before the portal split, no
  GHL token): coach = latest `post_trial_reviews.trainer`; trial date = newest
  `trial_bookings.schedule_slots(start_time)` → else `website_leads.fields.booked_slot`.
Everything is best-effort and renders empty on missing data / failed endpoints.

Related: [[project_sales_crew_guardrails]] (the "…→ contact drawer" drill-down),
[[project_v2_sales_board]].

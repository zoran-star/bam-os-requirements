# V1.5 Tier + Contacts Tab

2026-06-16. **V1.5** = a portal tier where the academy NEVER logs into
GoHighLevel — the BAM portal is their full CRM. GHL stays the data backend,
**synced live** into the portal. Lighter than V2 (fewer user requirements). May
need a little manual setup/cleanup to work right (Zoran).

> **2026-06-18 — V2 is a SUPERSET of V1.5 for Contacts.** The Contacts (full-CRM)
> tab now shows for V2 academies too (`v15_access OR v2_access`), since a V2
> academy still manages leads/contacts. Only the Contacts item is shared — V2
> keeps its own Inbox/KPIs/Calendar/Pipelines. Gated by `applyContactsNavState()`.
> See [[project_v2_onboarding_model]]. V2 demo clone to compare side-by-side:
> **"BAM GTA (V2)"** `50c14b2c-3f89-4438-ab73-3067bc0f7017`.

## Tier model
- Three tiers V1 / V1.5 / V2, mutually exclusive, set by staff via the **Portal
  tier** segmented control on the client Profile (`ClientsCombinedView.jsx`,
  replaced the old binary "V2 access" checkbox).
- Backed by two booleans: `clients.v2_access` + `clients.v15_access` (V1 = both
  false). The selector posts both via `/api/clients?action=update-fields`.

## V1.5 onboarding checklist (Action Items)
V1.5 academies get the full V2 onboarding checklist PLUS two V1.5-only steps,
tier-gated in `api/action-items.js` (`ONBOARDING_STEPS` entries with `tier:"v15"`;
`onboardingStepsForTier(isV15)` filters; `syncOnboardingItems` seeds only
applicable + deletes leftover tier-gated steps if an academy stops being V1.5).
New steps + columns (`clients.athlete_map_done_at`, `kpi_setup_done_at`):
- **v15_athlete_map** "Map your athlete-name field" → CTA `_aiOpenContactsSetup()`
  (Contacts → ⚙ Setup).
- **v15_kpi_setup** "Connect your KPIs" → CTA `_aiOpenKpiSetup()` (KPIs → ⚙ Setup modal).
V2/V1 never see these (hard rule respected). The checklist auto-hides once every
step is done (`showOnb` in `_renderActionItems`).

## Systems-team "Connect to offers" (staff app — build ticket)
New clients have NO pipelines/calendars until the systems team builds them (after
Trigger Buildout, which is after the Offer step). So connecting offers↔
pipelines/calendars/products is a STAFF action inside the systems-buildout ticket,
not a client one. `OfferConnect` panel in `src/views/SystemsView.jsx` TicketModal
(shown when `ticket.type==='onboarding'`): fetches `/api/offers/kpi-setup?client_id=`
(now returns `tier`), renders offer-link dropdowns for Stripe products / GHL
pipelines / GHL calendars + a ↻ Refresh (they build in GHL then refresh). **Hard-
block:** for V1.5/V2 onboarding tickets, Approve / Mark-complete are disabled
until ≥1 link exists (`connectBlocks`). V1 academies → panel shows "not used".

## V1 offer builder = simplified (no connections)
For **V1** academies (`!v2_access && !v15_access`, via `_bbIsV1()`) the offer
builder hides all integration/"connection" UI: Stripe price-match pill
(`_bbLivePill` returns '') — the matcher panel `_bbRenderOffersPricing` was
already V2-only — plus GHL tags (`ghl_tags_multi`/`ghl_tag`), entry points
(`entry_points`), and discovery-call calendar fields. Gated in
`_bbRenderStepFields` via `_V1_HIDE_TYPES`/`_V1_HIDE_KEYS`. V1.5/V2 keep
everything (they depend on it). Plain offer fields (sales path, pricing options,
info-to-collect, upsells, onboarding) stay for V1.

## Contacts tab (V1.5) — DONE (first V1.5 surface)
Client portal, gated to V1.5 via `applyV15NavState()` + nav `data-feature="v15"`
(mirrors the V2 gate). `openContactsView()` in client-portal.html.
- **Search** parent name / athlete name / phone / email · **filter** by tag.
- Reads the **`ghl_contacts` mirror** (NOT live GHL) → instant + reliable
  custom-field (athlete-name) search. Decided over live GHL because GHL's API
  searches custom fields poorly.
- **Setup** (the human part): map the athlete-name GHL **custom field(s)**.
  `GET /api/contacts?action=custom-fields` lists ALL fields live from GHL + flags
  which `hasData` + which are `suggested` (hasData && title ≈ athlete/player
  name); pre-selects suggestions. `POST ?action=set-athlete-fields` saves to
  `clients.v15_config.athlete_name_field_ids`. Default `GET /api/contacts` =
  search the mirror.

## Inbox tab (V1.5) — P1 DONE (fresh tab, Zoran chose "build fresh" not extend)
Separate from the existing V2 inbox: `switchView('v15inbox')` → `openV15Inbox()`,
gated by `data-feature="v15"`. Reuses the GHL backend (`/api/ghl/inbox` list +
thread, `/api/ghl/send-message` for SMS/Email + `attachments` URLs).
- **P1 (done):** conversation list (recent SMS+email), **unread** filter, thread
  view, composer (SMS/Email toggle + email subject + attachment upload to the
  `message-attachments` bucket), and **Setup** = synced sender email + phone
  (new `GET /api/ghl/inbox?action=sender-info` → GHL location phone/email).
- **P2 (done):** filter by pipeline + stage (contact→opp map from `/api/ghl/pipelines`) + filter by failed messages (`lastMessageStatus` added to the inbox API; failed = failed/undelivered/error/rejected). Toolbar pills + pipeline/stage selects; client-side filtering of the cached list.
- **P3 (done):** **mass send** — `✉ Mass send` in the inbox toolbar → modal
  (channel SMS/Email · tag audience · body/subject) → queues a job. Subsystem:
  `mass_send_jobs` + `mass_send_recipients` tables; `api/mass-send.js`
  (?action=create resolves audience from the mirror — tag + has-channel + **NOT
  dnd**; ?action=tags for the picker; ?action=status for progress;
  ?action=work = the **worker cron**, Bearer CRON_SECRET, drains 25 recipients/run
  with a 400ms gap, marks job done). Cron `/api/mass-send?action=work` every
  minute (vercel.json). `ghl_contacts.dnd` added + synced (skips do-not-contact).
  Modal polls status for a live progress bar; sending continues in the background.

## Pipelines tab (V1.5) — DONE (adjusted the existing board, kept simple)
Reuses the existing GHL kanban board (`view-pipelines`, drag/drop `_plDrop`, the
lead drawer w/ contact info + SMS/email). Added a V1.5-gated nav item "Pipelines"
→ `switchView('pipelines')` (data-feature="v15"). New:
- **Won/Lost/Abandoned + free-text reason:** `_plMarkWon/Lost/Abandoned` →
  `_plOutcome()` modal (reason textarea) → `_plSetStatus()` PATCHes GHL status +
  the pipelines API saves the reason to **`pipeline_outcomes`** (migration). Won
  is no longer a stub — it sets status 'won' (member-tie stays the separate
  "Convert to member" button).
- **Undo:** `_plShowUndo()` toast after a status change OR a drag move;
  `_plUndo()` reverses (status→'open', or move back to fromStageId).
Per Zoran: did NOT add a full "all GHL fields" dump — kept the drawer simple.

## KPIs tab (V1.5) — month-filtered dashboard, 5 sections (BIG, phased)
Gated v15: `switchView('v15kpis')` → `openV15Kpis()`. Month selector drives all
sections. Decisions (Zoran 2026-06-16): human-cleaned counts = **exclusions
table + undo** (raw count from GHL/Stripe, minus per offer/metric/month/contact
exclusions; undo restores; source untouched); Setup = **extend Price Match**.
- **P1 (done):** tab shell + month selector + **Marketing** — reuses
  `/api/marketing?resource=meta-report&months=12` (returns monthly `periods`
  w/ spend/leads/cpl); shows spend · leads · cost-per-lead as PLAIN numbers,
  **all good/bad indicators stripped** (no verdicts, no CPL-vs-target coloring,
  no ▲▼ trend colors) — "control the narrative." Other sections = shells.
- **Setup (done):** `api/offers/kpi-setup.js` + `kpi_offer_links` table (attribution
  only — distinct from `pricing_catalog` which routes checkout). GET assembles
  offers + Stripe products (ever-paid, w/ sub_count, from `status=all` sub scan +
  product list) + GHL pipelines + existing links. UI = a per-row offer dropdown
  for each Stripe product and each pipeline (saves instantly via POST
  `action=link`; offer_id null unties) + "+ New offer by title" (POST
  `action=create-offer` → lightweight `offers` row type=training/draft). Lazy
  loaded after Marketing (Stripe+GHL fetch is slow). These ties feed Sales/Revenue/Members.
- **Sales / Revenue / Members (DONE):** backend `api/kpis-v15.js`
  (`?section=sales|revenue|members&month=YYYY-MM`) + tables `kpi_exclusions`
  (human-cleaning) + `kpi_manual_cancellations`. Frontend = `_v15kSecHtml` /
  `_v15kEnsureSection` (per-month cache in `_V15K.sec`), painted into
  `#v15k-sales|revenue|members`.
  - **Sales:** per offer (from `kpi_offer_links`) — # **entered pipeline** = GHL
    opportunities created in the month in tied pipeline(s); # **new payments** =
    Stripe subs created in the month for tied products. Each count expands to its
    items; **×** excludes (with optional reason) → count drops; **Undo** removes
    the exclusion. Raw source untouched.
  - **Revenue:** gross / **net** (= gross − refunds − Stripe fees, via
    balance_transaction expand) / payouts; **failed payments** list with **Copy
    card link** (POST `action=billing-portal` → Stripe billing-portal session URL)
    + Customer ↗ (dashboard).
  - **Members:** month's succeeded payments (click → drawer w/ full info + Stripe
    receipt) · **cancelled subscriptions** count (subs `canceled_at` in month,
    human-cleaned via exclusions) · **manual cancellations** (search GHL mirror +
    Stripe customers → reason → date → `kpi_manual_cancellations`).
  - Cleaning model = exclusions table + undo (metrics `sales_pipeline` /
    `sales_payments` / `members_cancelled`, scoped by month + offer_id + ref_id).
- KPIs tab is now COMPLETE (all 5 sections live).

## Calendars tab (V1.5) — DONE (fresh booking-management surface)
Gated v15: `switchView('v15cal')` → `openV15Cal()`. Distinct from the V2
website-availability panel (`view-calendar`/`bk*`). Backend
`api/ghl/calendars-v15.js` (uses `getClientGhlToken` from website/availability):
GET `action=list` (all GHL calendars) · `action=events&calendar_ids=&start=ms&end=ms`
(week events across cals) · `action=appointment&id=` (appt + full live contact) ·
`action=settings&calendar=` (regular openHours + special = date overrides + capacity);
POST `action=set-status` · `action=create-appointment` · `action=settings`.
- **Weekly grid** (`_v15calRenderGrid`): 7-day × hour grid. Faint **dotted** cells =
  availability (union of selected calendars' regular hours + special-date overrides,
  via `_v15calOpenAt`); cells with ≥1 booking render **filled gold** + click →
  `_v15calOpenSlot` slot drawer listing that slot's bookings. Calendar multi-select
  chips (default all) + ⚙ per calendar + week nav.
- **Booking drawer** (`_v15calOpenAppt`): status `<select>` (confirmed/showed/noshow/
  cancelled/invalid → `_v15calSetStatus`), full contact (name/email/phone/tags/custom
  fields/DND), SMS/Email composer reusing `/api/ghl/send-message`.
- **Settings drawer** (`_v15calSettings`): regular hours (7 day rows) + capacity +
  **special hours** = add a date → custom open/close OR mark closed (Zoran's choice);
  merges with existing availabilities (reuses ids, marks removed dates deleted).
- **New booking** (`+ New booking` topbar): pick calendar → search existing contact
  via `/api/contacts` mirror → date/time → `create-appointment` (GHL contactId).
- Drawer infra = a dynamically-injected right-side overlay (`#v15cal-ov`).

## Mobile / PWA
- Phones hide the desktop `.sidebar`; nav is the fixed `.mobile-nav` bottom bar.
- **V1.5 bottom bar** (when `#mobileNav.is-v15`, toggled in `applyV15NavState`):
  **Inbox · Sales · KPIs · Support · More** (the `mnav-v15` buttons; the default
  `mnav-default` Home/Messages/Systems/Marketing are hidden). **Support**
  (`_mobileSupport`) pops a small overlay with **Marketing** + **Systems** boxes.
- **More** sheet (`_mobileMoreRender`) = the **academy switcher** (CLIENT_ROWS,
  searchable, `_mobileMorePickClient` → `switchClient`) + every enabled tab not on
  the bar (`_mobileBarViews()` decides exclusions per mode). This is the ONLY way
  to switch academies on mobile (the sidebar switcher is hidden there).
- `syncMobileNav` is DOM-based (lights whichever bar item owns the active view;
  Support lights on marketing/systems; else More).
- Mobile-friendly grids: `v15cal-board` (560px min-width + horizontal scroll),
  `v15k-2col`/`v15k-linkrow` stack ≤768px.

## Data + sync
- **`ghl_contacts`** table = per-academy GHL contact mirror (name/email/phone,
  `tags text[]`, `custom_fields jsonb`, resolved `athlete_name`). pg_trgm GIN
  search index + tags GIN. RLS: read = staff or my_client_ids; write = staff
  (service key).
- Populated by **`cron-sync-contacts.js`** (every 10 min) — extended to upsert
  the full mirror for `v15_access` academies (was members-only). `athlete_name`
  is resolved from the mapped custom field AT SYNC TIME.
- `clients.v15_config jsonb` holds V1.5 config (athlete_name_field_ids; room for
  more).

## Session state / open loops (2026-06-18 — heavy V1.5 build session)
- ⚠️ **BAM GTA flipped to V1.5 for testing** (id `39875f07-0a4b-4429-a201-2249bc1f24df`);
  normally **V2**. **Revert to V2 when done** (`v2_access=true, v15_access=false`).
- ⚠️ **GTA onboarding was RESET** for testing (all 17 action_items.completed_at
  cleared + writable mirror cols nulled), so its Business Blueprint "marked done"
  flags read as not-done. Reversible by re-checking. Athlete field IS mapped for
  GTA (`v15_config.athlete_name_field_ids=['RqNojS2YaVGQNjMAo4HB']`) + backfilled.
- **DETAIL Miami** (V1.5, id `4708a68d-5365-48bf-a404-72a69fadd34d`): Marketing
  shows nothing because `meta_ad_account_id` IS set but `meta_campaign_ids` is
  **null** — no campaigns selected. NOT a bug; staff must pick campaigns
  (meta-report returns `no_campaigns_selected` → no periods). 31 offer ties.
- Shipped this session (all live, V1/V2 hard-rule respected): KPIs Sales/Revenue/
  Members + bookings + one-time products + optimistic ×/Undo + ▾ hints + numbered
  Setup tabs; KPIs load without Meta (12-mo selector always) + parallel GHL;
  Calendars/Inbox/Contacts (athlete sort, full-sync pagination); Marketing
  stripped for V1.5 (Ad Performance + month-progress hidden, spend-only cards);
  Talk-to-BAM (locked to academy + Back btn); mobile bottom bar + More + account
  switcher; V1.5 onboarding steps (athlete-map, connect-KPIs); systems-team
  Connect-to-offers panel (hard-block); Pipelines Won needs no reason.

## Gotchas / pending
- `athlete_name` only fills AFTER the mapping is set AND a sync runs (≤10 min) —
  a fresh V1.5 academy's athlete search is empty until then. No manual backfill
  trigger yet (relies on the cron).
- Migrations: `20260616000000_clients_v15_access`, `20260616010000_ghl_contacts_mirror`.
- More V1.5 tabs/requirements coming (Zoran is speccing from a planning call).

Related: [[project_v2_onboarding_model]] (the V2 tier this sits beside).

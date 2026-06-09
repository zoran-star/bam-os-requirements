# Action Items (v1)

Shipped 2026-06-01. A shared per-client to-do list. Same rows shown on both
sides: the academy team in the client portal and BAM staff on the client's
staff-portal page. Any field on any row is editable by anyone who can see it.

> ## 📍 ONBOARDING STATE — read first (updated 2026-06-09)
>
> **The client onboarding flow IS the Action Items "Onboarding" checklist — 17 fixed steps.** Everything ships to `main` (auto-deploys). Live step order (authoritative = `action_items.sort_order`):
>
> ```
> 1 slack · 2 connect_stripe* · 3 create_ghl · 4 connect_ghl*
> 5 general_info · 6 staff · 7 locations · 8 brand · 9 kpis · 10 offers
> 11 book_call(SM) · 12 book_call_cam · 13 submit_content
> 14 trigger_buildout🔒 · 15 ready_for_review🔒 · 16 book_review_call · 17 book_call_ximena
>   (*auto from a connect signal · 🔒 = staff-only, hidden from clients)
> ```
>
> **UX:** first login → 2-step welcome → ACTION ITEMS. Onboarding renders as a **subway map** (circle nodes + line) inside a **collapsible gold "🚀 Onboarding" card that DISAPPEARS once all steps done**; ad-hoc to-dos are a separate collapsible "Tasks" panel. `book_review_call` is **locked/greyed until staff flip `ready_for_review`**.
>
> **Booking steps (data-driven via `staff.booking_url`):** SM = per-client `scaling_manager` ✅ · Cam = `marketing_manager` ✅ link set · **Ximena = `marketing_executor` ⏳ link still pending** (Slack fallback). GET returns `sm`/`mktg`/`ads`/`review_ready`. Helper `_aiBookingCta`.
>
> **Systems ticket (staff side):** `trigger_buildout` → `createSystemsOnboardingTicket()` builds it (due +7d; old auto DB trigger dropped). Ticket modal has 📋 **Copy-for-Claude** + per-field **"mark incorrect"** + **Send-corrections** (via requestClientAction). Lobby=unassigned/Ongoing=assigned. Admins are in the delegation pool. Assigned executor can Mark complete.
>
> **Two-way ticket notes (2026-06-08):** clients add notes anytime (`client_note`) + staff reply anytime (`staff_reply`) on every support ticket — see [[project_client_action_thread]].
>
> **Key code:** `ONBOARDING_STEPS` in `api/action-items.js`; client UI = `ONB_UI`+`_aiOnbHTML`+`_renderActionItems` in `client-portal.html`; staff = `onbRow`+`_AI_ONB_NOTES` in `ClientsCombinedView.jsx`.
>
> **All-academy client-switcher access** granted to `info@byanymeanstoronto.ca` (as "Zoran Savic") AND `admin@byanymeansbusiness.com` (Rosano) — `client_users` rows for every academy → switcher in the CLIENT portal. (Staff already see all clients in the staff portal via `is_staff()` RLS.)
>
> **⏳ OPEN ITEMS / next session:**
> 1. **Ximena's booking link** — set `staff.booking_url` for marketing_executor `24109bce-3f74-447e-a2cd-1714995331d7` when Zoran sends it (step 17 = Slack fallback until then).
> 2. **SM scheduling page** — decided GHL calendar (2-way Google sync) over custom build. Pending: confirm SMs have GHL users w/ Google connected + a BAM GHL location; then build a live free-slots page. (Today we just deep-link `booking_url`.)
> 3. **New build-team onboarding fields** convo — goals / current tools / hours / lead sources / A2P-SMS — never finished.
> 4. **A2P/SMS compliance block** in General — deferred.
> 5. **Recent gotcha (fixed PR #154):** modal hosts (`#stripe-modal-host`) must be TOP-LEVEL, not inside a `.view` — a `display:none` ancestor hides even `position:fixed` modals. Watch for this pattern on any new modal.

## Where it lives

| Surface | Location |
|---|---|
| Client portal | New **V1 nav tab "Action Items"** (always visible — no feature gate). `#view-action-items` in `bam-portal/public/client-portal.html`. Bottom-right **⊕ FAB** (`.ai-fab`) opens the create modal (`#actionItemModal`). |
| Staff portal | New **"Action Items" tab** (`id: "actionItems"`) in `bam-portal/src/views/ClientsCombinedView.jsx` → `ActionItemsTab` component. Inline add form + inline edit. |
| API | `bam-portal/api/action-items.js` — single endpoint, dispatch by method. |
| Table | `action_items` (Supabase, migration `create_action_items`). |
| Cron | `vercel.json` → `/api/action-items?action=cron-due-soon` daily at 13:00 UTC. |

## Data model — `action_items`

`id, client_id→clients, title (req), description, due_date (date, nullable),
assignee_id→client_users (nullable), assignee_name (denormalized for display),
completed_at (null = open), completed_by_name, created_by (auth uid),
created_by_name, created_by_role ('client'|'staff'), created_at, updated_at,
due_soon_notified_at`.

- **Done = `completed_at IS NOT NULL`** (checkbox model — no status enum). Completed items group at the bottom, struck-through.
- **Assignee = academy team only** for v1 (`client_users` rows for that client). Staff assignees come later. `assignee_name` is re-stamped on every reassign.
- RLS: `action_items_rw` policy — `is_staff() OR client_id IN (select my_client_ids())`. API uses the service role and bypasses RLS; policy is defense-in-depth.
- `updated_at` kept fresh by trigger `trg_action_items_updated_at`.

## API — `/api/action-items`

- `GET ?client_id=` → `{ items, team }` (team = active `client_users` = assignee options). Items ordered open-first, then soonest due, then newest.
- `POST` `{ client_id, title, description?, due_date?, assignee_id? }` → create + Slack ping.
- `PATCH` `{ id, ...fields }` → update any field. `completed:true/false` toggles done. A genuine reassign to a person fires a Slack ping. Changing `due_date` re-arms the due-soon ping (`due_soon_notified_at` → null).
- `DELETE ?id=` → delete (anyone with access; no soft-delete).
- `GET ?action=cron-due-soon` → CRON_SECRET auth (Vercel injects `Authorization: Bearer $CRON_SECRET`). Pings open items due within 2 days that haven't been pinged, then stamps `due_soon_notified_at`.

Auth/scope mirrors `tickets.js`: caller must be BAM staff (sees all) or a member of the client (owner / `client_users` / scaling manager).

## Slack

Reuses the per-client channel pattern (`clients.slack_channel_id`, `SLACK_BOT_TOKEN`) from `tickets.js`. Pings on **create + reassign + due-soon**. Silent no-op if no token or no channel mapped.

## Decisions locked (Zoran, 2026-06-01)

Done = checkbox · assignee = academy team only (staff later) · fully shared list · Slack on create+reassign+due-soon · due date optional · single assignee, can be unassigned · sorted soonest-due-first.

## Onboarding steps (added 2026-06-01)

Action Items doubles as the **client onboarding checklist**. A pinned "Onboarding"
group renders at the top of the list (client + staff), seeded from a fixed set of
steps keyed by `action_items.onboarding_key`:

9 steps total (2026-06-02). Each maps to a clients timestamp column (`col`) and
is either **writable** (toggling writes col — two-way sync) or **signal** (col is
an external connection signal):

| # | key | title | col | writable |
|---|---|---|---|---|
| 1 | `slack` | Join the BAM Slack workspace | `slack_join_done_at` | ✅ |
| 2 | `connect_stripe` | Connect your Stripe account | `stripe_connect_connected_at` | signal |
| 3 | `create_ghl` | Create your GoHighLevel sub-account | `ghl_signup_done_at` | ✅ |
| 4 | `connect_ghl` | Connect your GoHighLevel account | `ghl_connected_at` | signal |
| 5 | `general_info` | Fill out General Info | `general_marked_done_at` | ✅ → BB #bb=general |
| 6 | `staff` | Add your Staff | `staff_marked_done_at` | ✅ → BB #bb=staff |
| 7 | `locations` | Add your Locations | `locations_marked_done_at` | ✅ → BB #bb=locations |
| 8 | `brand` | Set up Brand & Website | `brand_marked_done_at` | ✅ → BB #bb=brand |
| 9 | `kpis` | Fill out your KPIs | `kpi_marked_done_at` | ✅ → BB #bb=kpis |
| 10 | `offers` | Set up your Offers | `offers_marked_done_at` | ✅ → BB #bb=offers |
| 11 | `book_call` | Book a call with your Scaling Manager | `call_booked_at` | ✅ → dynamic SM booking CTA |
| 12 | `book_call_cam` | Book a call with Cam (marketing) | `cam_call_booked_at` | ✅ → dynamic CTA from marketing_manager `booking_url` (Cam) |
| 13 | `submit_content` | Submit your raw content | `content_submitted_at` | ✅ → `_aiOpenNewCampaign()` opens the Marketing new-campaign wizard (bypasses the MARKETING_INCLUDED nav gate) |
| 14 | `trigger_buildout` | Trigger systems buildout | `systems_buildout_triggered_at` | 🔒 **staff-only** → creates the systems ticket |
| 15 | `ready_for_review` | Ready for review call? | `ready_for_review_at` | 🔒 **staff-only gate** → unlocks step 16. Staff note via `_AI_ONB_NOTES` |
| 16 | `book_review_call` | Book review call with Scaling Manager | `review_call_booked_at` | client step — **LOCKED/greyed until step 15 done**; then dynamic SM booking CTA |
| 17 | `book_call_ximena` | Book a call with Ximena (ads) | `ximena_call_booked_at` | ✅ → dynamic CTA from first `marketing_executor` (Ximena) `booking_url` |

GET also returns `mktg` (first `marketing_manager` = **Cam**, link set 2026-06-05: content-acceleration), `ads` (first `marketing_executor` = **Ximena**, link not set yet → Slack fallback), and `review_ready` (bool). `_aiBookingCta(person, fallback)` is the shared booking-button helper (SM `_AI_SM` · Cam `_AI_MKTG` · Ximena `_AI_ADS`).

**Locking:** `book_review_call` has `locked_by: "ready_for_review"`. Client portal renders it greyed/non-interactive with a 🔒 + "Unlocks once your build is ready for review" until `_AI_REVIEW_READY` (from GET `review_ready`). The staff "Ready for review call?" step shows a reminder note (`_AI_ONB_NOTES`) to verify systems + ad content before flipping.

(2026-06-03: `offers` added as step 9; the first-login product tour was cut from 8 steps to a 2-step welcome that just points the client at this Action Items checklist — see [[project_client_portal_tour]].)

**Staff-only steps (`staff_only: true` in ONBOARDING_STEPS):** hidden from clients — the GET filters them out when `!ctx.isStaff`; PATCH 403s a non-staff toggle. `ONBOARDING_STAFF_ONLY` set. Only `trigger_buildout` today.

**`trigger_buildout` (2026-06-05):** staff checks it → `createSystemsOnboardingTicket()` (in api/action-items.js) builds the systems ticket (type onboarding, **due +7 days**, assigned to first systems_manager, full snapshot payload) and stamps `clients.systems_onboarding_ticket_id`. Idempotent. **This REPLACED the old auto-create DB trigger** `trg_systems_onboarding_ticket` (dropped) — see [[project_support_ticket_system]].

**`book_call` (2026-06-05):** writable manual step. Its CTA is dynamic — the GET response now returns `sm: { name, booking_url }` (the client's `scaling_manager_id` → `staff.booking_url`). Client portal renders **"Book with {SM first name} ↗"** linking to that URL; if no SM / no link → **"Message us on Slack ↗"** (`ONB_SLACK_INVITE_URL`). New cols: `staff.booking_url`, `clients.call_booked_at`. Seeded SM links: Anthony McManus (Google) + Mike Eluki (GHL widget). Helpers: `loadClientSM()` (api), `_aiBookCallCta()` + `_AI_SM` (client). Migration `book_call_onboarding_step`.

- `syncOnboardingItems()` reconciles every step from its `col` on each GET.
  **Writable** steps always mirror col (toggling writes col, so consistent) — this is
  the two-way sync with the BB "I'm done with X" buttons. **Signal** steps mirror col
  UNLESS `action_items.onboarding_overridden` is set (human toggled by hand → human wins).
- Every step is **check/uncheck-able by hand** (client OR staff). Toggling a writable step
  writes its `col`; toggling a signal step sets `onboarding_overridden`.
- Steps 5–9 are the **off-call form steps** — their client-portal CTA (`_aiOpenBB`) jumps to
  the matching Business Blueprint section; completion = that section's mark-done.
  Note: `general_info` keys ONLY off `general_marked_done_at` (the explicit "I'm done with
  General" click), NOT the tracker's auto-derive (name+owner+email) — so it can read
  not-done even when the BB tracker shows general_done.
- Onboarding rows **can't be deleted** (API guard); `sort_order` 1–17 (see the steps table above for the live order).
- **UI (2026-06-05):** the Onboarding group renders as a **subway map** (`.ai-subway` / `.ai-stop` — circle nodes + connecting line that fills gold as steps complete) inside a **collapsible gold "🚀 Onboarding" card** (`.ai-section-onb` + `_aiToggleSection`) that **hides entirely once all steps are done**. Ad-hoc to-dos are a separate collapsible "Tasks" panel.
- Migrations: `action_items_onboarding_key`, `action_items_onboarding_overridden`,
  `clients_timezone_kpis` (+ time_zone, kpi_data, kpi_marked_done_at; extended
  update_client_basics + mark_onboarding_section), `onboarding_progress_kpis`.
- Schema: `action_items.onboarding_key` (text, null = ad-hoc) + `sort_order` (int) +
  unique `(client_id, onboarding_key)`. Migration `action_items_onboarding_key`.
- Seeded for **all clients** (backfill 2026-06-01) + lazily on every GET (idempotent via
  `on_conflict`), so new clients auto-get them.
- Client-portal CTAs reuse existing flows: Slack invite (`ONB_SLACK_INVITE_URL`),
  `openStripeConnectModal()`, `openGhlConnectModal()`. UI config = `ONB_UI` (client-portal.html);
  staff auto-set = `_AI_ONB_AUTO` (ClientsCombinedView.jsx).
- To add a step: extend `ONBOARDING_STEPS` in `api/action-items.js`, add to `ONB_UI` (client)
  + `_AI_ONB_AUTO` (staff) if auto, and backfill existing clients.

## Gotchas / future

- Client portal calls go through `/api/action-items` with the Supabase JWT (`_mreqAuthToken()`), NOT direct `_sb` table reads — so RLS isn't exercised from the browser today.
- Mobile bottom-nav got a 6th item ("Actions"). Watch for crowding on very small screens.
- Staff assignees + notifications-to-staff are the obvious v2.
- Onboarding **manual** flags now have TWO writers: the BB onboarding tracker AND the Action Items step — both write the same `clients.*_done_at` columns, so they stay consistent. Keep it that way.

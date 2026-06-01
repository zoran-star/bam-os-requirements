# Action Items (v1)

Shipped 2026-06-01. A shared per-client to-do list. Same rows shown on both
sides: the academy team in the client portal and BAM staff on the client's
staff-portal page. Any field on any row is editable by anyone who can see it.

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

| key | title | mode | signal / flag column |
|---|---|---|---|
| `slack` | Join the BAM Slack workspace | **manual** | writes `clients.slack_join_done_at` |
| `connect_stripe` | Connect your Stripe account | **auto** | `clients.stripe_connect_connected_at` |
| `create_ghl` | Create your GoHighLevel sub-account | **manual** | writes `clients.ghl_signup_done_at` |
| `connect_ghl` | Connect your GoHighLevel account | **auto** | `clients.ghl_connected_at` |

- **AUTO** steps self-complete from the live clients-row signal via `syncOnboardingItems()`
  (reconciled on every GET) — BUT every step is also **check/uncheck-able by hand** (client
  OR staff). The moment a human toggles a step, `action_items.onboarding_overridden` is set
  true and the auto-reconcile leaves it alone from then on (human wins). Migration
  `action_items_onboarding_overridden` (2026-06-01).
- **MANUAL** steps are checkboxes (either side can tick/untick — fully shared). Ticking ALSO
  writes the canonical `clients` flag, so the **legacy onboarding tracker pill stays in
  sync** (see [[project_v2_onboarding_model]]); unticking clears it.
- Onboarding rows **can't be deleted** (API guard) and have `sort_order` 1–4.
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

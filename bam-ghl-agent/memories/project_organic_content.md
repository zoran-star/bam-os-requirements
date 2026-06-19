# Organic Content (client + staff)

Shipped 2026-06-18. A second content pipeline alongside Ads, gated per-client.

## The two pipelines (both ride `content_tickets`, distinguished by `channel`)
- `channel='ads'` (default) → client → content team → **Send to Marketing** → marketing_tickets → Meta. (the existing flow)
- `channel='organic'` → client → content team → **Send for client review** → client Approves/Requests-changes → **Creative Bank**. NO marketing ticket spawned.

## Schema (migrations applied 2026-06-18)
- `content_tickets.channel text not null default 'ads'`
- `clients.organic_content boolean not null default false` — the per-client gate

## Status mapping for organic (reuses existing content_tickets statuses)
- `active`            → "In progress" (content team building)
- `client-dependent`  → "Review" (sent to client; client_action_status='requested')
- `completed`         → "Creative Bank"

## API (`api/marketing.js` handleContentTickets)
- POST create reads `body.channel` ('ads'|'organic').
- GET supports `&channel=organic` filter (client + staff).
- New actions: staff **`send-for-review`** (needs final_files; sets client-dependent + requested; no marketing spawn); client **`approve`** (→completed/bank) + **`request-changes`** (→active, back to content team). Added to staffActions/clientActions sets.

## Staff toggle
- `ClientsCombinedView` MarketingTab → "Organic content" toggle (copies the marketing_included switch) → POST `/api/clients?action=update-fields` `{organic_content}`. Field validated in `api/clients.js` (`wasSet("organic_content")` block). Staff clients load via `select("*")` so it's already there.

## Client portal (`client-portal.html`)
- `ORGANIC_CONTENT` global, set from the client row select (added `organic_content` to the `.select(...)` at the client load + the client-switch path).
- Marketing tab entry (`switchView('marketing')` → `_marketingEnter()`): if ORGANIC_CONTENT, lands on the **Ads | Organic split** (`#marketing-channel-split`), else straight to `#marketing-list`.
- `_chooseChannel('ads'|'organic')`, `_backToChannelSplit()`, `_hideAllMarketingSub()`. Ads view gets a `#marketing-ads-back` back button.
- `#marketing-organic`: ① Request a new creative (`openOrganicRequestModal()` → sets `_inputAssetsChannel='organic'` then the existing Add-Creative modal; `submitInputAssets` sends `channel` + context.source='organic-request'); ② Status of creatives (`_fetchAndRenderOrganic` → in-progress/review cards, review has Approve / Request changes); ③ Creative bank (completed final_files). Helpers: `_organicStatusCard/_organicBankCard/_organicFileTile/_organicApprove/_organicRequestChanges`.

## Staff content view (`ContentView.jsx`)
- For `ticket.channel === 'organic'` the end button is **"Send for client review"** (calls `send-for-review`) instead of "Send to Marketing".

## Content routing / assignment (added 2026-06-19, branch `feat/content-routing-assignees`)

New `content_executor` role — CONTENT-ONLY. In `_roles.js` it's in `ANY_STAFF_ROLES`/`ASSIGNABLE_STAFF_ROLES` + new `CONTENT_ROLES`, but deliberately NOT in `MARKETING_ROLES`/`MARKETING_OPS_ROLES`/`META_OPS_ROLES` → can't launch campaigns, change budgets, or touch Meta/Client Setup. New `CONTENT_MANAGER_ROLES` (admin/scaling_manager/marketing_manager) = who may reassign + manage the roster. Eli White = content_executor. `canSeeContent` (App.jsx) includes it; `canSeeMarketing` does NOT; content_executor lands on the Content tab.

**Routing precedence** at content-ticket create (`marketing.js` `resolveContentAssignee`): `ticket.assigned_to` override → `clients.content_assignee_<channel>_id` (admin roster) → channel default (organic→Eli via `CONTENT_ORGANIC_ASSIGNEE_EMAIL`/first content_executor, ads→Cam via `MARKETING_MANAGER_EMAIL`). New-ticket Slack DM now pings the **resolved owner**, not always Cam.

**Schema** (migration `20260619150000_content_assignment_routing.sql`): `content_tickets.assigned_to → staff(id)`; `clients.content_assignee_organic_id` + `content_assignee_ads_id → staff(id)` (all `on delete set null`, nullable → V1-safe).

**Surfaces:**
- `ClientsCombinedView` SetupTab → "Organic content owner" + "Ads content owner" pickers (gated `ROLES.canAssignContent`). Saves via `update-fields` (field-gated to `CONTENT_MANAGER_ROLES` in `clients.js`).
- `ContentView` → new manager-only **Routing** tab (`ContentRoutingTab`): per-client grid of organic/ads owners; organic picker disabled when `organic_content` off. Writes the same fields.
- `ContentView` queue scoping: `content_executor` sees only `assigned_to===me.id`; managers see all.

**Client never sees assignee:** `stripInternalMessages` now also deletes `assigned_to` (runs only on client GET/PATCH; staff use `enrichWithClient`). Client portal selects `clients` by explicit column list (no `content_assignee_*`). `assign` PATCH action gated to `CONTENT_MANAGER_ROLES`.

**Env to set in Vercel:** `CONTENT_ORGANIC_ASSIGNEE_EMAIL` = Eli's staff email (else falls back to first `content_executor` row). `MARKETING_MANAGER_EMAIL` already defaults to `cameron@byanymeansbusiness.com`.

## To demo
Flip the staff "Organic content" toggle on a client → their Marketing tab shows the Ads | Organic split.

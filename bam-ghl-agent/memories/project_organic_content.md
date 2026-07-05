# Organic Content (client + staff)

Shipped 2026-06-18. A second content pipeline alongside Ads, gated per-client.

## The three pipelines (all ride `content_tickets`, distinguished by `channel`)
- `channel='ads'` (default) → client → content team → **Send to Marketing** → marketing_tickets → Meta. (the existing flow)
- `channel='organic'` → client → content team → **Send for client review** → client Approves/Requests-changes → **Creative Bank**. NO marketing ticket spawned.
- `channel='funnel'` (added 2026-07-05) → client → content team → **Send to Systems** → creates a `tickets` row (type change, source `funnel-content`, finals attached, backlink `fields.funnel_content_ticket_id`) → systems team adds it to the website. Content ticket flips completed + `context.systems_ticket_id`. No credits, no marketing ticket. Gate = `marketing_included` (server-enforced on POST). **Owner = Cam, fixed** (`resolveContentAssignee` returns marketingManagerStaffId for funnel - deliberately NO per-client roster override; content_executors never see funnel tickets since queue scoping is assigned_to). Slack: request DM goes to Cam + #content-marketing labeled "funnel content"; on send-to-systems the client channel gets ONE message via the tickets-insert trigger (fields.title feeds its headline) - no explicit API Slack, that would double-notify. **Client split is now Ads | Funnel | Organic (organic 3rd, hidden when off) and shows for EVERY marketing client - previously only organic-enabled clients saw a split (V1-visible change, Zoran-flagged on the PR).**

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

⚠️ **GOTCHA — `staff.role` has a DB CHECK constraint `staff_role_check`** enumerating allowed role strings. Adding a new staff role needs BOTH the app-layer sets in `api/_roles.js`/`StaffModals` AND a migration that rebuilds `staff_role_check` to include it — otherwise invite-staff fails with `new row for relation "staff" violates check constraint "staff_role_check"`. Fixed for content_executor in `20260620120000_staff_role_add_content_executor.sql`. Keep the constraint's role list in sync with `ANY_STAFF_ROLES`.

## Organic credits + content-only clients (V1, added 2026-06-20, branch `feat/organic-content-credits`)

**Monthly credits (hard cap, no billing).** Migrations `20260620180000` (per-type) + `20260621120000` (combined pool):
- `clients.organic_total_credits_per_month` = **combined pool** (video + graphic share it, e.g. Jeremy Major = 12 any mix). NULL = no combined limit. **This is the common case.**
- `clients.organic_video_credits_per_month` + `organic_graphic_credits_per_month` = optional **per-type hard caps** for restricted clients (int; **NULL = no cap, 0 = type not included** e.g. graphics-only = video cap 0).
- A request must pass **BOTH** the pool (if set) AND the per-type cap (if set). Enforced in `api/marketing.js`; `organicUsedThisMonth(clientId, null)` counts the whole pool, `organicCreditSummary` returns `{total, video, graphic}`. Staff inputs: "Total / mo" + "Video cap" + "Graphic cap" in MarketingTab. Client meter shows the **Creatives x/N** pool pill (per-type pills only when a cap is set).
- "Used" = COUNT of this-calendar-month organic content_tickets of that type with `status != cancelled` (counted **at request**; cancelling frees one; revisions reuse the same ticket so never double-count). No counter column.
- **Enforced server-side** in `api/marketing.js` content-tickets POST: organic graphic/video request past allowance → `403 {code:'credit_limit'}` with a friendly message. This is the real "can't go past" guarantee.
- `GET ?resource=content-tickets&summary=credits` (client scope, or staff w/ `client_id`) → `{ video:{used,allowance,left}, graphic:{...} }` for the meter.
- Client portal organic view: `#organic-credit-meter` pills (`_fetchAndRenderOrganicCredits`/`_renderOrganicCredits`); request button disabled only when NO type has capacity; 403 surfaces cleanly + refreshes meter.
- Staff: `ClientsCombinedView` MarketingTab → "Monthly organic credits" inputs (🎬 Videos/mo, 🖼 Graphics/mo) under the organic toggle. Saved via `update-fields` (validated in `clients.js`: int>=0 or null).
- **V2 (deferred):** overage past cap + Stripe auto-charge (per-client rate). V1 is hard-cap only.

**Content-only clients.** Organic is now **decoupled from ads** (`marketing_included`):
- Surface shows when `marketing_included OR organic_content` (gates in `switchView`, `mobileSwitchView`, `applyMarketingNavState`).
- Content-only (`organic_content` ON + `marketing_included` OFF) → `_marketingEnter`/`_backToChannelSplit` go **straight to organic** (no Ads|Organic split, back button hidden via `_showOrganicOnly`); nav relabels **"Marketing" → "Content"**.
- Staff one-click **"Make content-only"** preset in MarketingTab → sets `marketing_included=false` + `organic_content=true`.

## To demo
Flip the staff "Organic content" toggle on a client → their Marketing tab shows the Ads | Organic split.
Set credits + "Make content-only" in the client's Marketing setup → client sees a Content-only portal with `🎬 x/N · 🖼 x/N` meters and gets blocked past the cap.

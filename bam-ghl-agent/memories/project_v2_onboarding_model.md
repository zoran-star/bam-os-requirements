# V2 Onboarding Model

The canonical doc for how onboarding, V2 access, the Business Blueprint, the tracker pill, and the Slack welcome all fit together. Read this before changing anything in those four surfaces.

> ⚠ **KEEP THIS UPDATED.** Any change to the staff toggle, the V2/V1 split, the BB cards, the tracker visibility logic, the mark-done flow, or the welcome Slack flow MUST update this note in the same commit. If something here is stale, the next session will burn an hour re-deriving the model and probably get it wrong.

> **2026-06-20 — companion notes for the big V2 build:** per-staff access control
> (tabs/stages/KPIs), preview-as, hide BAM staff, default-to-owned-academy, Home
> hidden for V2, mobile V2 bottom bar → [[project_staff_permissions]]. Sales
> drawer / inbox / mobile UI / missed-trial / CAC / email-off → [[project_v2_sales_inbox_ui]].

> **2026-06-18:** the V1.5→V2 jump is member management, and members are now
> **offer-scoped** — `members.offer_id`/`members_staging.offer_id` derived at
> import from the member's Stripe price (`pricing_catalog.offer_id`), mirroring
> `entry_points.offer_id`. See [[project_member_management_portal]] Session 7.
>
> **2026-06-18 — V2 ⊇ V1.5 (full superset).** V2 now inherits the V1.5 full-CRM
> surfaces on top of its member-management tabs. Helper `_isCrmTier()` = `V15_ACCESS
> || V2_ACCESS`; `applyCrmSupersetNav()` (renamed from applyContactsNavState,
> called from BOTH `applyV2NavState` + `applyV15NavState`) shows these V1.5 items
> for V2 too, by id:
> - **Contacts** (`#nav-contacts`) — full CRM
> - **Inbox** (`#nav-v15inbox`) — the UPGRADED v15 inbox (filters, attachments,
>   sender setup, **MASS SEND**). V2's older inbox nav (`#nav-v2inbox`,
>   switchView('inbox')) is **retired/hidden** for V2; `_msgBack` + default both
>   point V2 at `v15inbox` now.
> - **KPIs** (`#nav-v15kpis`) — the v15kpis dashboard (V2 previously had NO KPIs tab).
>
> NOT surfaced for V2: `v15cal` + the v15 pipelines item — V2 has its own Calendar
> + Pipelines (Pipelines is the SAME view for both). **Marketing** gets the V1.5
> action-oriented "narrative" treatment for V2 too (no Ad-Performance report / month
> progress / Results-CPL header / verdict+winfix — only ad-spend cards): the 3
> render gates now use `_isCrmTier()`. **Mobile bottom bar** uses the v15 set
> (Inbox·Sales·KPIs·Marketing·Systems) for V2 as well (`is-v15` class + `_mobileBarViews`
> via `_isCrmTier()`). The v15 view openers (openV15Inbox/openV15Kpis) have no
> V15-only guard, so they work for V2. Shipped on branch `feat/v2-superset-v15`.
> (Per-academy note: V2's old member-classifying inbox view still EXISTS as a view,
> just no nav — revisit if member-linking in the inbox is wanted.)
>
> **Tier flags are mutually exclusive** (`v15_access` XOR `v2_access`). **BAM GTA
> is now V2** (`v2_access=true`, set 2026-06-18) — flipped from V1.5 so Zoran
> could see V2 with its live Stripe + GHL on real data. The older "GTA is the
> only V2 client" line below is true again (toggle it back to V1.5 anytime via
> the staff tier control). A "BAM GTA (V2)" DB-only demo clone existed briefly
> (id 50c14b2c…) but was **DELETED 2026-06-18** — a second client row can't share
> GTA's GHL location (`ghl_location_id` is UNIQUE) or Stripe (webhook matches
> members by sub-id with no client filter → collision), so the clone showed
> "not connected" everywhere; flipping the real client is the only way to see a
> fully-connected V2. **Portal can't create GHL pipelines** — built in GHL by the
> systems team, then linked to offers (GHL API doesn't expose pipeline creation).

## V1 vs V2 — what each client sees

The staff "V2 access" toggle (per client) is the only switch. Today V2 unlocks **5 nav items**: Members, Pricing, Inbox, Pipelines, Calendar. Everything else is V1 and visible to every client.

| Surface | V1 (default) | V2 (`clients.v2_access = true`) |
|---|---|---|
| Messages | ✅ | ✅ |
| Systems | ✅ | ✅ |
| Marketing | ✅ (if `marketing_included`) | ✅ (if `marketing_included`) |
| Resources | ✅ | ✅ |
| Business Blueprint | ✅ | ✅ |
| Onboarding tracker pill | ✅ (if any section incomplete) | ✅ (same) |
| Members | ❌ | ✅ |
| Pricing | ❌ | ✅ |
| Inbox | ❌ | ✅ |
| Pipelines | ❌ | ✅ |
| Calendar | ❌ | ✅ |

**Gating mechanism (client-portal.html):** Members, Pricing, Inbox, Pipelines all carry `data-feature="members"` and are toggled together by `applyMemberMgmtNavState()` (`MEMBER_MGMT_ENABLED && V2_ACCESS`). Calendar carries `data-feature="calendar"` and is toggled by `applyCalendarNavState()` (`CALENDAR_ENABLED && (V2_ACCESS || V4_ACCESS)`). **Native gate LIFTED 2026-07-06** (Cole: testing BAM GTA in the iOS app, mobile is a first-class V2 target) — the 5 V2 items now show in the native wrapper too. Business Blueprint + Team remain **web-only** via `!isNativeApp()` (NOT V2-gated — every web client sees them).

## The staff toggle

- Lives in `bam-portal/src/views/ClientsCombinedView.jsx` `OverviewTab`
- Writes `v2_access` (boolean) to `clients` via `/api/clients?action=update-fields`
- Renamed from `onboarding_in_progress` on 2026-05-27 — old name dropped from the schema
- Default: `false` (new clients are V1)
- Today: BAM GTA (id `39875f07-0a4b-4429-a201-2249bc1f24df`) is the only V2 client

## The Business Blueprint (V1 — visible to everyone)

Top-level nav: "Business Blueprint". Landing renders a **hero Offers card** + a **2-col grid** of General · Staff · Locations · Brand.

Hash routing:
- `#bb=general` · `#bb=staff` · `#bb=locations` · `#bb=brand` · `#bb=offers`
- `#bb=offers/<id>` opens the offer wizard
- `#bb=offers/new?type=<type>` starts a new offer

Each card is a real CRUD surface (no more "Coming soon"):

| Card | Backing | Persistence |
|---|---|---|
| Offers | `offers` + `offer_teams` + `offer_files` tables | auto-save via `_bbAutoSave()` (debounced 600ms) |
| General | clients row (business_name, address, legal_name, entity_type, ein, time_zone) | `update_client_basics` RPC, debounced 600ms |
| Staff | `client_users` (academy teammates) + **Owner block** (owner_name/email/phone on clients row, `_bbStaffOwnerChanged`) | invite / revoke modals shared with the merged Team page |
| Locations | `locations` table | `_bbOpenAddLocationModal` + inline delete |
| Brand | `clients.brand_data` jsonb (colors / fonts / logo URLs / website spec) | `update_client_basics` RPC, debounced 600ms |
| KPIs | `clients.kpi_data` jsonb (revenue/clients/sales/expenses) | `update_client_basics` RPC, debounced 600ms |

> **2026-06-02:** Owner contact (owner_name/email/phone) moved OUT of the General card into an **Owner block at the top of the Staff card** — still the same clients-row columns, just edited there. Entity type "Other" now reveals a free-text box; the custom value is stored directly in `entity_type` (so it's "Other" when the value isn't one of the 5 presets — `_ENTITY_PRESETS`).

## Onboarding tracker pill (V1)

Top-right floating pill, always visible while any BB section is incomplete. Click to expand a 320px panel with 6 circles. Click a circle → navigates to that section. Click outside or another circle → panel collapses.

```
[ ✓ Onboarding · 2/6  ▾ ]      ← collapsed
[ ✓ Onboarding · 2/6  ▴ ]      ← expanded
└─ panel with 6 circles ──┘
```

**No client-side dismiss** — staff used to control visibility via `onboarding_in_progress`, but that flag became `v2_access`. The tracker now hides only when every section is done.

### Done-state derivation per section

Six sections, three different completion mechanisms. **This table is the source of truth — keep it in sync with `get_onboarding_progress()` RPC.**

| Section | Trigger | Where it's set |
|---|---|---|
| GHL signup | staff/client | Client click opens `ONB_GHL_SIGNUP_URL`. `ghl_signup_done_at` is now toggled via the **Create GHL** Action Items onboarding step (either side). *(The old "GoHighLevel signup complete?" checkbox in the staff Overview Setup section was removed 2026-06-03 — Action Items replaced it.)* |
| Join Slack | staff/client | `ONB_SLACK_INVITE_URL`. `slack_join_done_at` now toggled via the **Join Slack** Action Items step. *(Old "Joined BAM Slack workspace?" Setup checkbox removed 2026-06-03.)* |
| General | auto-derived (+ manual override) | clients.business_name + owner_name + email all set, OR staff sets `general_marked_done_at` |
| Staff | manual mark-done | "I'm done with Staff" button on BB Staff card → `mark_onboarding_section('staff', true)` |
| Locations | manual mark-done | "I'm done with Locations" button on BB Locations card → `mark_onboarding_section('locations', true)` |
| Brand | manual mark-done | "I'm done with Brand" button on BB Brand card → `mark_onboarding_section('brand', true)` |
| Offers | manual mark-done | "I'm done with Offers" button on BB Offers list → `mark_onboarding_section('offers', true)` |
| Meta Ads | staff-controlled | BAM staff toggles "Meta Ads onboarding complete?" on the staff client **Marketing** tab (moved here from Overview 2026-05-27 so the marketing surface owns the marketing check) → writes `clients.meta_ads_marked_done_at` |

Tracker has 8 sections total. Layout is a 4×2 grid (380px panel). The 2 external sections (GHL + Slack) don't gate the systems onboarding ticket — that trigger only fires on the 5 BB sections (General + Staff + Locations + Brand + Offers).

> ⚠ **Second writer (2026-06-01):** `slack_join_done_at` and `ghl_signup_done_at` are now ALSO written by the **Action Items onboarding steps** (`slack` → slack_join_done_at, `create_ghl` → ghl_signup_done_at). Ticking the step in the Action Items tab writes the same column this tracker reads, so the two stay in sync. `stripe_connect_connected_at` + `ghl_connected_at` drive AUTO Action Items steps (Connect Stripe / Connect GHL) but are NOT tracker sections. See [[project_action_items]].

> ⚠ **More second-writers (2026-06-02):** the BB form steps now also exist as Action Items onboarding steps that write the same `*_marked_done_at` columns this tracker uses — `general_marked_done_at` · `staff_marked_done_at` · `locations_marked_done_at` · `brand_marked_done_at`. Two-way synced with the BB "I'm done with X" buttons. See [[project_action_items]].

## BB restructure (2026-06-10): Pricing → Offers · new "Member Onboarding" card

- **Pricing nav page RETIRED.** Nav item + `switchView('pricing')` hook removed
  (view-pricing markup left dead in the file, unreachable — cleanup later). The
  old "Match with AI" + temp Sorter launch buttons died with it.
- **BB → Offers** gained a **Pricing section** under the offers list
  (`_bbRenderOffersPricing`): Stripe connect gate (pill/CTA → existing modal;
  state from `/api/members?scope=client`, which also caches `_STRIPE_CONNECT_STATE`)
  + "🧮 Match prices to Stripe" → `openPricingSorter(1)` (the wizard now takes a
  start step: 1 match · 2 import · 3 cleanup).
- **Seventh BB card: "Member Onboarding"** (`#bb=member_onboarding`,
  `_bbRenderMemberOnboarding`). **Locked until `_obtProgress.offers_done`.**
  4 steps: ① Connect GHL (gate, existing modal) ② Import members →
  `openPricingSorter(2)` ③ Cleanup & promote → `openPricingSorter(3)`
  ④ **Link GHL contacts** → `_moRunGhlLink()` — new `api/sorter/link-ghl.js`
  (propose = members with null `ghl_contact_id` matched ↔ GHL contacts by
  email→phone; apply = fill `ghl_contact_id`, NULL-only, idempotent). Closes
  the gap where CSV-imported members were invisible to the 10-min contact-sync
  cron. No mark-done flag / tracker section for this card (yet).
- Action Items Stripe/GHL connect steps KEPT — they auto-✓ on connection and
  open the same modals (one checklist, two homes).

## New "KPIs" BB card (2026-06-02)

Sixth BB card: **KPIs** (`#bb=kpis`). Baseline metrics (revenue / clients / sales / expenses), all optional. Stored in **`clients.kpi_data` jsonb** (same auto-save pattern as `brand_data`); mark-done flag **`clients.kpi_marked_done_at`** via `mark_onboarding_section('kpis')`; `get_onboarding_progress()` now returns `kpis_done`. Renderer `_bbRenderKpisCard`/`_bbKpisChanged`; field list = `_BB_KPI_GROUPS` + `_BB_KPI_IDS`. Also a `kpis` Action Items onboarding step (#9). **General card** gained **Time Zone** (`clients.time_zone`, `_BB_TZ_OPTS`). Website NOT added to General — already in `brand_data.website_url`/`domain`.

Manual flags persist as timestamps on the clients row:
- `ghl_signup_done_at`
- `slack_join_done_at`
- `general_marked_done_at` — General is auto-derived (business_name + owner_name + email all set) but staff can also manually override via this timestamp; done-state = `auto OR override`
- `staff_marked_done_at`
- `brand_marked_done_at`
- `locations_marked_done_at`
- `offers_marked_done_at`
- `meta_ads_marked_done_at`

External URLs live in client-portal.html constants:
- `ONB_GHL_SIGNUP_URL` — currently the Stripe Buy link for GoHighLevel
- `ONB_SLACK_INVITE_URL` — BAM Business Slack invite (shared workspace)

Un-mark button appears alongside each Mark-done CTA once flipped — sets the timestamp back to NULL.

## Slack welcome message (one-shot)

When a client finishes setting their password via the invite link, `submitNewPassword()` fires `POST /api/clients?action=post-welcome-slack` (fire-and-forget). Server:

1. Resolves the client from `auth_user_id`
2. Short-circuits if `clients.welcome_slack_sent_at` is already set
3. Posts to `clients.slack_channel_id` if mapped (else marks sent anyway so we don't retry every login)
4. Sets `welcome_slack_sent_at = NOW()` on success

Message text:
> 🎉 Welcome to BAM, <Business>! <Owner> just set up the portal account.
>
> *This channel is where notifications live for now.* When something needs your attention — a ticket update, an action request, a content drop, anything — it'll land here.
>
> Portal: https://portal.byanymeansbusiness.com/client-portal.html

Idempotent. Safe to call on every password set (recovery flow harmlessly no-ops).

## First-login product tour

Spotlights the Systems / Marketing flows on first portal entry. Gated only on `clients.onboarding_completed_at IS NULL`. **No longer gated on V2 access** (used to require `onboarding_in_progress === false`; that flag became `v2_access` and lost its onboarding meaning).

Skip / complete writes `onboarding_completed_at` — fires exactly once per client.

## Auto-resend invite cron

Hourly Vercel cron at `/api/clients?action=cron-resend-invites`. Re-issues invite links to `client_users` whose linked `auth.users` has never signed in + never confirmed, every 20h, max 7 retries. Auth via `CRON_SECRET` env var. Posts to Slack on retries 1–3.

## Files / functions to know

| Concern | Where |
|---|---|
| V2 toggle UI | `bam-portal/src/views/ClientsCombinedView.jsx` OverviewTab (look for `v2Access`) |
| `v2_access` field validator | `api/clients.js` action=update-fields |
| Members nav gate | `applyMemberMgmtNavState()` in `client-portal.html` (ANDs `V2_ACCESS`) |
| Tracker pill render | `_obtRender()` + CSS `#obt-widget` |
| Mark-done CTA helper | `_bbMarkDoneCta(section, label)` |
| Done-state derivation | `get_onboarding_progress(p_client_id)` RPC |
| Welcome Slack | `post-welcome-slack` branch in `api/clients.js` + `submitNewPassword()` in `client-portal.html` |
| Resend invites cron | `cron-resend-invites` branch in `api/clients.js` + `vercel.json` cron entry |

## Common pitfalls

- **Don't gate the tour on `v2_access`** — that's the renamed flag, semantically wrong. Tour gate is just `!onboarding_completed_at`.
- **Don't read `onboarding_in_progress`** — column doesn't exist anymore. Use `v2_access`.
- **Don't add new manual done-flags as booleans** — they're all `*_marked_done_at` timestamps, so we can answer "when did this section get marked done" later.
- **Don't render the tracker conditionally on a client flag** — it's V1, visible to everyone with incomplete sections.

## When to update this note

Update in the same commit that ships the change. Triggers:

- Schema change to `clients.v2_access` (rename, drop, type) or any `*_marked_done_at` column
- New BB card added or removed
- New tracker section added to the 6
- Change to the staff V2 toggle label / behavior
- Change to the welcome Slack message or trigger
- Change to the first-login tour gate
- Change to the auto-resend invite cron cadence or auth
- New V2 feature added (Members is the only one today)
- Tracker visibility logic changes

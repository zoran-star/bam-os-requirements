# V2 Onboarding Model

The canonical doc for how onboarding, V2 access, the Business Blueprint, the tracker pill, and the Slack welcome all fit together. Read this before changing anything in those four surfaces.

> ⚠ **KEEP THIS UPDATED.** Any change to the staff toggle, the V2/V1 split, the BB cards, the tracker visibility logic, the mark-done flow, or the welcome Slack flow MUST update this note in the same commit. If something here is stale, the next session will burn an hour re-deriving the model and probably get it wrong.

## V1 vs V2 — what each client sees

The staff "V2 access" toggle (per client) is the only switch. Today V2 adds **Members + Calendar** to the nav. Everything else is V1 and visible to every client.

| Surface | V1 (default) | V2 (`clients.v2_access = true`) |
|---|---|---|
| Messages | ✅ | ✅ |
| Systems | ✅ | ✅ |
| Marketing | ✅ (if `marketing_included`) | ✅ (if `marketing_included`) |
| Resources | ✅ | ✅ |
| Business Blueprint | ✅ | ✅ |
| Onboarding tracker pill | ✅ (if any section incomplete) | ✅ (same) |
| Members | ❌ | ✅ |
| Calendar | ❌ | ✅ |

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
| General | clients row (business_name, owner_name, email, phone, address, legal_name, entity_type, ein) | `update_client_basics` RPC, debounced 600ms |
| Staff | `client_users` (academy teammates) | invite / revoke modals shared with the merged Team page |
| Locations | `locations` table | `_bbOpenAddLocationModal` + inline delete |
| Brand | `clients.brand_data` jsonb (colors / fonts / logo URLs / website spec) | `update_client_basics` RPC, debounced 600ms |

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
| General | auto-derived | clients.business_name + owner_name + email all set |
| Staff | manual mark-done | "I'm done with Staff" button on BB Staff card → `mark_onboarding_section('staff', true)` |
| Locations | manual mark-done | "I'm done with Locations" button on BB Locations card → `mark_onboarding_section('locations', true)` |
| Brand | manual mark-done | "I'm done with Brand" button on BB Brand card → `mark_onboarding_section('brand', true)` |
| Offers | auto-derived | ≥1 non-archived row in `offers` for this client |
| Meta Ads | staff-controlled | BAM staff toggles "Meta Ads onboarding complete?" on the staff client overview tab → writes `clients.meta_ads_marked_done_at` |

Manual flags persist as timestamps on the clients row:
- `staff_marked_done_at`
- `brand_marked_done_at`
- `locations_marked_done_at`
- `meta_ads_marked_done_at`

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

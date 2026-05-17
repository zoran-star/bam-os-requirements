---
name: Clients consolidation — Notion → Supabase (2026-05-17)
description: Migration that made Supabase `clients` the single source of truth for client profile data, replacing the Notion-only "Client Profiles" parent page for portal reads.
type: project
---

## TL;DR — what changed

Before: portal's **Clients tab** read from Notion (`CLIENT_PROFILES_PAGE = 3295aca8ac0f81f09b88c60e84173738`), portal's **Client Setup tab** read from Supabase `clients`. They were not in sync.

After: both read from Supabase. Notion stays writable as a human/relationship notes layer but doesn't drive the portal.

## Schema changes

```sql
ALTER TABLE clients RENAME COLUMN name TO business_name;
ALTER TABLE clients ADD COLUMN scaling_manager_id uuid REFERENCES staff(id) ON DELETE SET NULL;
CREATE INDEX clients_scaling_manager_id_idx ON clients(scaling_manager_id);
```

Applied 2026-05-17 via Supabase MCP `apply_migration` named `consolidate_clients_from_notion`.

## What got backfilled

15 matched clients (Notion ↔ Supabase) had `owner_name`, `email` (4 of them), `scaling_manager_id`, and `notion_page_id` (1 of them) populated from the Notion Client Info table.

2 brand-new Supabase rows were inserted from Notion-only clients:
- **Out Work** (Niko Brooks, Mike Eluki as manager)
- **Alex Twin** (minimal — most fields TBC)

1 new staff row created: **Alex Silva**, role `scaling_manager` (ACTIV8's manager). Mike Eluki kept his existing `admin` role.

## New role: `scaling_manager`

Added to `staff.role` (free text column, no enum). Same permissions as `admin` everywhere — added to perm checks in:
- `src/App.jsx` (canSeeSystems, canSeeMarketing, canSeeTeam, canSeeContent, canSeeFinancials, canSeeClientSetup, isSystemsTeam logic)
- `src/views/ClientsView.jsx` (isAdmin)
- `src/views/SettingsView.jsx` (Team section visibility)
- `api/tickets.js` (systemsRoles, isManager)
- `api/clients.js` (ADMIN_LIKE_ROLES, MARKETING_ROLES)

## Code rename strategy: `name` → `business_name`

DB column renamed. API layer (`api/clients.js`, `api/tickets.js`, `api/marketing.js`, `api/asana/tasks.js`) all updated to use `business_name` in selects, inserts, and PATCH bodies.

**Frontend rename incomplete** — `shapeClient()` in `api/clients.js` returns BOTH `business_name` AND `name` (aliased to business_name) so the dozens of UI files reading `client.name` / `c.name` still work. This is a **temporary alias** — finish the UI rename to fully remove `.name`.

Files with `.name` still pointing at the client object (legacy via alias):
- `src/App.jsx` (showToast, reminders, sortedClients dropdown)
- `src/views/ClientModal.jsx` (multiple references, including `CLIENT_GHL_MAP[client.name]` lookups)
- `src/views/ActiveCard.jsx`
- `src/views/ClientsView.jsx` (Send invite UI)
- `src/views/ClientSetupView.jsx` (c.name in row + picker)
- `src/views/UnifiedTasksView.jsx`
- `src/views/FinancialsView.jsx`
- `src/views/DashboardView.jsx`
- `src/views/OnboardingRow.jsx`
- `src/components/overlays/CommandPalette.jsx`
- `src/components/overlays/SearchOverlay.jsx`

Files where client.name was already migrated to `client.business_name`:
- `src/views/MarketingView.jsx`
- `src/views/ContentView.jsx`
- `src/views/SystemsView.jsx`
- `src/views/AsanaImportView.jsx`
- `public/onboarding.html` (POST body)
- `src/views/ClientSetupView.jsx` create-client POST body

## ClientsView rewire status

Still TODO — currently still reads from `fetchAllClients()` → Notion `all_clients` query. Need to replace with Supabase fetch + remove `isNotionMode` flag.

## Mike-doc items (questions to walk through with Mike)

Captured for review:

1. **BAM NY / BAM San Jose / BAM WV** have stale `notion_page_id` (Notion pages no longer under Client Profiles). Need profile data filled in via Client Setup or Notion.
2. **BAM GTA, BTG, DETAIL Miami, Pro Bound Training** — Supabase clients with no Notion profile at all. Need profile data.
3. **Alex Twin** — minimal row created with everything blank. Real client or stale prospect?
4. **Alex Silva** — created as new staff with role=scaling_manager. Confirm full name, email, when she needs to log into the portal.
5. **"scaling_manager" role** — currently gets same perms as admin. Rework with proper role-specific scope later.
6. **Supreme Hoops** — `owner_name = "Anthony Rizzo & Anthony Sciff"` as single string. Add second-owner field later if needed.
7. **test business** row left in Supabase as the test client per `[[project_local_dev_workflow]]`.

## Scripts (kept in repo for re-run / rollback context)

- `scripts/migration/inspect-clients.mjs` — read-only inspector showing per-row state on both sides
- `scripts/migration/backfill-clients.mjs` — dry-run by default, `--apply` to write
- `scripts/migration/list-staff.mjs` — print full staff table
- `scripts/migration/check-role-type.mjs` — verify `staff.role` is text not enum
- `scripts/migration/schema-migration.sql` — fallback DDL if MCP is offline

## Gotchas hit during migration

- Vercel `vercel env pull` writes URLs with literal `\n` if the source env was set via `echo |` instead of `printf |`. Parser must strip `\\n` (see `[[feedback_vercel_env_no_newline]]`).
- Match algorithm needed to: strip parenthetical suffixes (e.g. "Danny Cooper Basketball (DCB)"), substitute `+` → " plus " (Basketball+ → Basketball Plus), `&` → " and ".
- "Active Clients" field in Notion is mostly "(to be confirmed)" garbage — skip via `isGarbageValue()`.
- Notion "Email" sometimes contains two emails separated by `/` — script takes first, but `EMAIL_OVERRIDES` map handles ACTIV8 specifically (Jana picked over TJ).

## Related notes

- [[project_client_portal_flow]] — onboarding.html → client row flow (updated to POST business_name)
- [[project_meta_api_integration]] — Meta API uses `clients.business_name` now for display
- [[project_marketing_content_flow]] — ticket flow uses `client.business_name` in views

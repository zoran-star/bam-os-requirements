# V1.5 Tier + Contacts Tab

2026-06-16. **V1.5** = a portal tier where the academy NEVER logs into
GoHighLevel — the BAM portal is their full CRM. GHL stays the data backend,
**synced live** into the portal. Lighter than V2 (fewer user requirements). May
need a little manual setup/cleanup to work right (Zoran).

## Tier model
- Three tiers V1 / V1.5 / V2, mutually exclusive, set by staff via the **Portal
  tier** segmented control on the client Profile (`ClientsCombinedView.jsx`,
  replaced the old binary "V2 access" checkbox).
- Backed by two booleans: `clients.v2_access` + `clients.v15_access` (V1 = both
  false). The selector posts both via `/api/clients?action=update-fields`.

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

## Gotchas / pending
- `athlete_name` only fills AFTER the mapping is set AND a sync runs (≤10 min) —
  a fresh V1.5 academy's athlete search is empty until then. No manual backfill
  trigger yet (relies on the cron).
- Migrations: `20260616000000_clients_v15_access`, `20260616010000_ghl_contacts_mirror`.
- More V1.5 tabs/requirements coming (Zoran is speccing from a planning call).

Related: [[project_v2_onboarding_model]] (the V2 tier this sits beside).

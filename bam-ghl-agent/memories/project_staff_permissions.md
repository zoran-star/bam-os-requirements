---
name: Per-staff permissions + Preview-as (client portal RBAC)
description: 2026-06-19/20 — academy owners (and BAM staff) control which TABS, pipeline STAGES, and KPI CATEGORIES each teammate sees; placeholder add + invite; hide BAM staff; preview-as; default-to-owned-academy; Home hidden for V2.
metadata:
  type: project
---

# Per-staff permissions + Preview-as

The client-portal access-control layer. The academy **owner** (and any **BAM
staff** admin) configure each teammate from **Business Blueprint → 👥 Staff**.
Everything is in `bam-portal/public/client-portal.html` + `api/clients.js`.

## Schema (client_users)
- `allowed_tabs   jsonb`  — array of tab keys; **NULL = all** (migration 20260619000000)
- `allowed_stages jsonb`  — array of GHL stage ids; NULL = all (20260619010000)
- `allowed_kpis   jsonb`  — array of KPI category keys; NULL = all (20260620000000)
- `hide_from_team boolean NOT NULL default false` — hide BAM staff from the
  client team lists (20260619020000; backfilled true where the membership's
  user_id/email is in the `staff` table)
- (existing) `role` = owner|member, `status` = active|revoked, `user_id` (NULL =
  placeholder, not invited yet), `email` (nullable).

**SUBTRACTIVE model:** permissions only ever HIDE things the tier already shows;
never reveal. The **owner is never restricted**. NULL = unrestricted.

## Client-side engine (client-portal.html)
- `_PERMISSIONABLE_TABS` (12: marketing, resources, assets, blueprint, members,
  inbox→[inbox,v15inbox], pipelines, calendar→[calendar,v15cal], contacts,
  kpis→[v15kpis], action_items→[action-items], systems). Home/Messages always on.
- `_KPI_CATEGORIES` = marketing · sales · revenue · members.
- Globals: `_MY_ALLOWED_TABS/_MY_ALLOWED_STAGES/_MY_ALLOWED_KPIS`, `_MY_TAB_ROLE`,
  `_IS_BAM_STAFF` (staff-table lookup, once, via `_ensureStaffFlag`), `_PREVIEW_AS`.
- `_eff*()` accessors return the PREVIEW values when previewing, else the real
  ones — so all gates respect preview-as.
- Gates: `applyTabPermissions()` (hides nav incl. mobile, !important on mobile so
  it beats the bar CSS), `_isViewTabAllowed()` (switchView guard, blocks hash/
  deep-link), `_isStageAllowed()` + `_plVisiblePipelines()` (board + tabs hide
  disallowed stages; a pipeline with no visible stages disappears), `_isKpiAllowed()`
  (gates the v15kpis sections).
- `loadMyPermissionsAndApply()` loads the current user's row at boot + on client
  switch; `_loadPreviewStaff()` loads the teammate list + staff flag.

## Staff card UI (BB → Staff, owner OR BAM staff)
Per teammate: **🎛 Tab access** checklist (only tabs the tier has), **🛣 Pipeline
stages** picker (lazy-loaded from GHL, per-pipeline whole-pipeline toggle),
**📊 KPI categories** checklist, **email field + ✉ Invite**, **👁 Preview**, photo.
Saves via `set-staff-tabs` (now patches allowed_tabs AND/OR allowed_stages AND/OR
allowed_kpis). `_bbStaffMetaSet()` keeps the preview snapshot LIVE so re-previewing
reflects latest, and re-applies in place if currently previewing that teammate.
Gate var is `iAmOwner = role==='owner' || _IS_BAM_STAFF` (BAM staff manage any
academy; backend actions already allow `isStaffCaller`).

## Add teammate / invite (api/clients.js, before the staff-only gate)
- `add-teammate` — placeholder row (user_id NULL, email optional), NO invite.
- `update-teammate` — edit a not-yet-invited teammate's email/name (owner-only).
- `invite-team-member` — now accepts `member_id` to invite an EXISTING placeholder
  (links the auth user to that row instead of creating a duplicate).
- UI: team modal has "Add without invite"; each placeholder row shows an email
  input + ✉ Invite + a "Not invited" pill.

## Preview-as <teammate> (owner / BAM staff)
Adopt a teammate's perms to QA their view without logging in as them.
- Entry points: 👁 Preview on the Staff card; **account menu** (`#previewAsBlock`
  via `_renderPreviewAsMenu`); **mobile More sheet** (bottom). `_previewAsStaff(id)`
  / `_exitPreview()`. Banner `#preview-banner` (HIDDEN on mobile — Exit lives in
  the More sheet). Restrict-only: preview can never escalate.

## Hide BAM staff
All client-facing team/staff queries filter `.eq('hide_from_team', false)`
(Staff card, _bbLoadStaff offer picker, merged Team page, names lookup). The
post-trial "trainer leading the sale" dropdown merges the GHL picklist with
client_users teammates so academy staff (e.g. Adrian/Fil) appear.

## Default academy + Home (related)
- Active academy on boot = (1) last-selected (localStorage `bam_active_client`,
  set in switchClient), else (2) an academy you **OWN**, else (3) first
  alphabetical. Fixes multi-academy logins (e.g. info@byanymeanstoronto.ca, owner
  of BAM GTA only) landing on the wrong (V1) academy.
- **Home tab hidden for V2** users (BAM staff keep it): `applyHomeNavState()` +
  `_homeHiddenForMe()`; `_landingView()` picks the first visible tab; switchView
  bounces a hidden Home to the landing tab.

## Demo state (BAM GTA, 39875f07-…)
- **BAM GTA is V2** (`v2_access=true`). Owner login info@byanymeanstoronto.ca.
- Teammates added as placeholders: **Fil** (email byanymeansfil@gmail.com, NOT
  invited yet — owner taps ✉ Invite to send the login; tabs=Sales-focused) and
  **Adrian** (no email). Sergio + Rosano are BAM staff → hidden from the team list.

## Sandbox / live agent
The "live agent link" = `portal.byanymeansbusiness.com/sandbox` — the staff-only
Sales-Agent TRAINING sandbox (chat as a parent → Claude proposes the agent reply
+ teach lessons; NEVER sends to GHL/a phone). Backend `api/agent-sandbox.js`;
behaviour = vendored BAM GTA booking prompt + active lessons.

See [[project_v2_onboarding_model]] (tier model) and [[project_v2_sales_inbox_ui]]
(the Sales/Inbox/mobile pass shipped alongside this).

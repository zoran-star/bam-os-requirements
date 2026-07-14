# Offer Architecture

The unified "Offer" concept that powers the Business Blueprint > Offers card on the client portal. Read this before touching anything under `_bbOfferConfigs`, the offers/offer_teams/offer_files tables, or the field-renderer engine.

## The mental model

An **Offer** is anything an academy sells. Every offer is one of **6 types** with type-specific data, all stored in the same `offers` table (jsonb payload). The shared shape: title + type + draft/published/archived status + a jsonb `data` blob with per-section values.

## The 6 offer types

| Type | Slug | What it is |
|---|---|---|
| Training | `training` | Recurring weekly classes / academy program. Block-builder for "Classes" — each class has age, skill, gender, weekly times. |
| Team | `team` | Competitive team — season + tryouts. **Special** (see below). |
| Camps / Clinics | `camp_clinic` | Single or multi-day intensive |
| Internal League | `league` | Recurring season + playoffs |
| Internal Tournament | `tournament` | Single event + brackets |
| Gym Rental | `gym_rental` | B2B on-demand booking |

## Sections (per offer)

Five of the six types share the same 6 sections, walked through as a multi-step wizard:

1. **General Info** — title, description, age, skill, gender, location
2. **Schedule** — when it runs
3. **Value** — program structure, what makes it different
4. **Pricing** — multi-pricing block builder
5. **Sales** — sales path, lead capture, upsells
6. **Onboarding** — agreement files, intake form fields, notify-on-signup

Each section is a list of fields in `_bbOfferConfigs[<type>]` keyed by section id.

### Policy section (training only, added 2026-07-13)

Training has a **7th section, Policy**, inserted after Pricing. It captures hard, typed rules (all optional, none required): `cancellation` + `cancel_notice_amount`/`cancel_notice_unit`, `pause_allowed` + `pause_min_days`/`pause_max_days`/`pause_per_year`, `refund_policy` + `refund_window_days`, `makeup_policy`. Saves to `offer.data.policy`. Same-section deps only (pause/refund/cancel sub-fields hang off their own toggle).

The Policy tab is added **additively** in `_bbWizardSections`: it appears only for offer types whose `_bbOfferConfigs[type]` array contains a `policy` section (training does; others don't), so other types are untouched. `_bbSectionLabels` has `policy:'Policy'`.

**Consumers:** the enrollment agreement (`api/_lib/agreement-pdf.js` `buildClauses()`) generates clause 6 (billing/cancellation) from `offer.data.policy`; `api/website/checkout.js` passes those clauses to `renderAgreementPdf` when policy is set, else falls back to legacy `sampleClauses`.

**Policy actions endpoint `api/offers/policy.js`** (added 2026-07-13), called from the Policy tab's `policy_actions` custom field (`_bbPreviewAgreement` / `_bbPushPolicyToAgent` in client-portal.html):
- `GET ?action=preview` → returns the generated `buildClauses()` array so the owner can preview the exact agreement (unbranded modal) without a test enrollment.
- `POST ?action=push-agent` → `policyToAgentText(policy)` → upserts the academy's `agent_prompt_sections` override for `section_key='policies'` (offer_id tagged). User-triggered, so the live booking agent never changes silently. Auth = Supabase JWT (staff or `client_users` member); writes run service-role.

Still-open: `pause_allowed` is not yet read by the member-drawer Pause action (member-management enforcement is unbuilt).

## Form builder — Sales / Onboarding "info to collect" (Gap #5, phase 5A-1, 2026-07-13)

The Sales and Onboarding sections each render a `custom_field_defs`-backed panel via `_bbRenderCustomQuestions` (`section='sales'` = the free-trial/lead form, `section='onboarding'` = the intake form; scoped by `offer_id`). This is being turned into a real form builder.

**5A-1 shipped:** the optional questions render as **editable cards** (`_bbCqCardHtml`) instead of read-only chips. `_bbCqOpenEditor(offerId, sectionId, clientId, fieldId)` handles both add (fieldId '') and **edit** (real id → PATCH); `_bbCqSaveEditor` POSTs/PATCHes. New per-field **note** (`custom_field_defs.help_text` column, added additively via `execute_sql` + migration `20260714120000_custom_field_defs_help_text.sql`) + a **Required** toggle, both wired through `api/custom-fields.js` create + PATCH. Field types unchanged (`_BB_CQ_TYPES`: text/number/date/select/multiselect/boolean/phone/email/url).

**5A-2 shipped:** drag-drop reorder of the cards (grip handle, `_bbCqDragStart/Over/Drop/End` mutate the section cache + `_bbCqPersistOrder`) backed by `POST /api/custom-fields ?action=reorder` (stamps `position=index`).

**5A-3 shipped:** a **live form preview** ("Preview form" button per section) via new `api/offers/form-preview.js` (Supabase-JWT auth) which reuses the live funnel's `buildFields()` (now `export`ed from `api/website/offer.js`) so the preview never drifts from what a lead/member sees. `offer.js`'s `cfDefToField` + defs select now pass `help_text` through. Client: `_bbCqPreviewForm` + `_bbCqRenderPreviewField`, rendered in the shared `_bbShowDocModal`.

**5C shipped:** member-import AI-suggested onboarding fields. The Pricing Sorter's mapping step (`_sorterRenderStep2`) has an "Add leftover columns to your onboarding form" button → `_sorterSuggestFields` posts the unmapped columns + samples to new `api/sorter/suggest-fields.js` (Claude proposes onboarding fields, skips dupes, resolves the training offer) → checklist modal (`_sorterFieldsModal`) → `_sorterApplySuggestedFields` creates the picked ones via `POST /api/custom-fields` (section=onboarding, offer_id). Non-blocking (doesn't touch the commit flow); drops the onboarding `_bbCqCache` so the builder shows them.

**Still to build (5B):** the actual live website form (bam-client-sites funnel) still renders `multiselect`/`number`/`url` as plain text (`cfDefType` collapses them) and doesn't yet show `help_text` - the portal preview does; plus forms↔offer enforcement + the contact-form-academy-wide rule. Optional follow-through: backfill `member_field_values` from `members_staging.raw` at promote so imported members carry values for the newly-added fields (today `raw` is dropped at promote).

## Sales preset (Gap #2)

The pipeline preset engine `api/agent/presets.js` (`applyPreset`, `PRESETS.free_trial` = GTA's exact 5-stage/20-edge model) stamps `pipeline_stages` + `stage_transitions` only; CLI-trigger (`scripts/apply-preset.mjs`), no UI. Design: `docs/agent-preset-architecture.html`.

**2A shipped (offer → agent facts):** new `api/offers/sync-agent.js` (Supabase-JWT auth) generates the booking agent's FACT prompt sections (`business_info`, `program`, `schedule`, `pricing`, `selling_points`, `policies`) from `offer.data` + client, `?action=preview` returns them and `POST` upserts `agent_prompt_sections` overrides (offer_id tagged; only sections the offer can fill). Sales-section "Sync booking agent from this offer" button → `_bbAgentSyncPreview` (preview + per-section checkboxes) → `_bbAgentSyncApply`. Reversible in Agent learnings; user-triggered so the live agent never changes silently. Supersedes the narrower policy-only push.

**2B shipped (preset-apply UI):** new `api/offers/apply-preset.js` (Supabase-JWT auth) wraps `applyPreset()` behind the portal - `?action=preview` dry-runs (returns stages + routing + workers), `POST` applies (409 `needs_force` on edge conflict). Sales-section "Set up the sales pipeline" button → `_bbPresetPreview` (shows the Free Trial stages + 20 routes) → `_bbPresetApply` (with a Replace-on-conflict path). Stamps `PRESETS.free_trial` onto the offer's `pipeline_stages` + `stage_transitions`.

**Still to build (2C-2D):** seed automations (ghosted/nurture/form-intro) from the preset; seed entry_points/funnels/custom_field_defs (GHL-id dependent). Fact sections the offer does NOT cover (coach ratio, group sizes, pricing transparency mode, geo-qualification, social proof) still need a dedicated agent-facts interview.

## Team is special

The Team type has only **2 top-level sections** (General + Per team), because Team is an umbrella for *multiple* specific teams under one program brand.

- **General** — program-level identity (brand, description, differentiator)
- **Per team** — a builder that lets the owner add one row per *specific* team (e.g. "15U Black", "U14 Girls"). Each team row gets 6 collapsible *subsections* of its own:
  - identity (age, gender, head coach, coaches, roster cap, home location)
  - schedule (consistent? + practice slot block-builder)
  - competition (leagues, tournaments)
  - sales (tryouts? + tryout details, reg form, lead notify, upsells)
  - pricing (fee, structure, addons, discounts)
  - onboarding (agreement file, intake form, notify-on-signup)
  - + an Extra notes textarea per subsection

Each subsection also has its open/closed state preserved across re-renders via `_bbTeamExpandedSubs`.

## Schema

```
offers          One row per offer
  id              uuid PK
  client_id       uuid FK → clients
  type            text (training/team/camp_clinic/league/tournament/gym_rental)
  title           text
  status          text (draft/published/archived)
  data            jsonb { general_info: {...}, schedule: {...}, ... }
  sort_order      int
  created_at, updated_at, created_by

offer_teams     One row per *specific team* under a Team offer
  id              uuid PK
  offer_id        uuid FK → offers (cascade delete)
  title           text
  data            jsonb (flat — every team subsection's fields at one level)
  sort_order      int

offer_files     Uploaded files for an offer (or per-team)
  id              uuid PK
  offer_id        uuid FK → offers
  team_id         uuid FK → offer_teams (NULL for offer-scoped files)
  section         text — disambiguator (see "File uploads" below)
  filename        text
  storage_path    text
  mime_type       text
  size_bytes      bigint
  sort_order      int
```

RLS: scoped by `client_id` membership via `my_client_ids()`.

Storage bucket: `offers` (public). Path layout:
- offer-scoped: `<client_id>/<offer_id>/<sectionId>/<fieldKey>/<stamp>-<name>`
- team-scoped: `<client_id>/<offer_id>/teams/<team_id>/<fieldKey>/<stamp>-<name>`

`offer_files.section` holds the field identifier to keep multiple file fields in the same section separate:
- offer scope: `'<sectionId>:<fieldKey>'`
- team scope: `'<fieldKey>'` (team data is flat)

## Field-renderer engine

Two parallel renderers — same field types, different data scope.

**Offer-scope** — `_bbRenderField(field, sectionId)`
- Reads/writes `_bbState.offer.data[sectionId][field.key]`
- Auto-saves to `offers.data` via debounced `_bbAutoSave()` (600ms)
- Has the most field types

**Team-scope** — `_bbRenderTeamSubField(teamId, f, val)`
- Reads/writes `_bbTeamRows[i].data[field.key]` (flat — no per-subsection nesting)
- Saves to `offer_teams.data` via `_bbSaveTeam(teamId)`
- Brought to parity with offer-scope 2026-05-26 — supports every field type the offer renderer does

Both support: `text`, `textarea`, `link`, `phone`, `email`, `currency`, `number`, `time`, `check_one`, `check_many`, `check_many_defaults` (offer-scope only), `block_builder` (with collapsible rows + summary), `location_picker`, `staff_select` (placeholder until real staff selector ships), `file` / `files`, `info`, plus `dep:{key,equals}` conditional visibility.

## Important gotchas

- **Team subsection state** — `<details>` elements re-emit without their `open` attribute on every re-render. Without the `_bbTeamExpandedSubs` Set + `ontoggle` handler, clicking a button inside an expanded subsection collapses it. Fixed 2026-05-26 — don't regress.

- **Extra notes per team subsection** — must use prefixed keys (`identity_extra_notes`, `schedule_extra_notes`, etc) because all team data lives flat at `team.data.<key>`. Re-using `extra_notes` would collide across subsections. See `_bbTeamExtraNotes(subId)` helper.

- **File uploads need a saved offer** — the widget short-circuits when `_bbState.offer.id` is null, since `offer_files` rows reference the offer. New offers must be saved before file fields work.

- **Locations picker** — backed by the `locations` table, edited at BB > Locations. Files / inputs picking a location store just the UUID. If a location is later deleted, the offer falls back to "Pick a location…" on next render.

- **Section key for file widget** — getting this wrong produces orphan uploads. Always use `<sectionId>:<fieldKey>` for offer-scope, just `<fieldKey>` for team-scope.

## Known gaps (intentional, not bugs)

- **Real staff selector** — `staff_select` fields currently render as text inputs with a placeholder. Will become a real picker once the BB Staff card is wired to populate the choice list. This applies to offer-scope AND team-scope; both will benefit at the same time.
- **Brand-derived styling** — landing pages built from offer data don't yet pull colors / fonts from BB > Brand. Planned.
- **Stripe wiring** — Pricing fields capture intent but don't create Stripe products / prices yet. Manual today.

## Field type: `ghl_workflow` (2026-06-19)

New offer field type — a single GHL **workflow** picker (Sales step). Used by the
**Missed-trial automation** field (`key:'missed_trial_workflow'`): the owner picks
the GHL workflow that auto-fires when a trainer marks an athlete **"Didn't show
up"** on the post-trial form. Stored at top-level `offer.data.missed_trial_workflow`
(workflow id) via `_bbUpdateOfferTopKey`. Renderer lazy-loads the academy's
workflows via `_bbLoadWorkflows()` → new `GET /api/ghl/workflows?client_id=`
(lists `{id,name}` from GHL `/workflows/?locationId=`). Hidden for V1 offers
(`_V1_HIDE_TYPES`). Enforcement lives in `api/ghl/post-trial.js`: on
`showed_up === false` it reads the training offer's `missed_trial_workflow` and
POSTs `/contacts/{id}/workflow/{wfId}` (non-fatal; `result.missed_trial =
fired|no_workflow|failed`). Same per-academy offer-data pattern as `signup_url`.
See [[project_sales_comms]].

## When to update this note

- New offer type added → update the 6-types table + section list
- New field type added to the renderer → update the field-types list
- Schema change to offers / offer_teams / offer_files → update the Schema block
- New known gap or gotcha discovered → add to the gotchas or gaps list
- Field-renderer refactor → update the engine section

## Deleting offers (2026-06-10)

Clients can delete an offer from the BB Offers list (🗑 on each tile,
`_bbDeleteOffer`). **Delete = `status: 'archived'`** — a recoverable flip, never
a hard DELETE. Archived offers are excluded from: the offers list
(`neq('status','archived')`), the `offer_select` dropdowns, and the price
matcher's targets (`status=neq.archived`). Staff can restore by flipping the
status back in Supabase.

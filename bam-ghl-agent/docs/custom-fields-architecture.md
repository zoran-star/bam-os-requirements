# Custom Fields Architecture (portal-native, off GHL)

> **Read this before touching `custom_field_defs`, `contact_field_values`, the offer-wizard
> "Info to collect" panel, the member-drawer Custom Fields section, or `api/custom-fields.js`.**
>
> Status: shipped end-to-end for BAM GTA (2026-07-01). Custom fields are **portal-native** -
> defined, authored, captured, stored, displayed, and used in messaging entirely in the portal.
> GHL still receives a **dormant copy** of values (until the `contact_provider` flip), but the
> portal no longer depends on GHL for any part of the custom-fields lifecycle.

Related notes: [`memories/project_contacts_store.md`](../memories/project_contacts_store.md) (the
contacts store this sits on), [`memories/project_offer_architecture.md`](../memories/project_offer_architecture.md)
(the offer wizard), [`memories/project_twilio_messaging_spine.md`](../memories/project_twilio_messaging_spine.md)
(the "own-store + provider toggle" pattern this mirrors).

---

## 1. TL;DR - what "custom fields" are now

A **custom field** is any per-contact data point beyond the base contact record (name/email/phone).
In GHL these were "custom fields / custom values". We rebuilt them portal-native:

- **Definitions** live in `custom_field_defs` (the catalog: label, type, options, scope).
- **Values** live in `contact_field_values` (one typed value per contact + field).
- **Authoring** happens in the **offer wizard** ("Info to collect" panel) and a staff **Custom Fields tab**.
- **Capture** happens on **form submit** (values written straight to the portal, real-time).
- **Display / edit** happens in the **member drawer**.
- **Messaging** reads portal values for merge vars (e.g. `{{athlete_first_name}}`).

The bridge back to GHL is a single nullable column, `custom_field_defs.ghl_field_id`, used for
one-click import and the dormant dual-write. Nothing in the lifecycle *requires* it.

---

## 2. The mental model - two axes

### Axis A: core vs extra (WHERE a field is scoped)

| | Scope | Meaning | Shown in wizard as |
|---|---|---|---|
| **CORE** | academy-level (`offer_id IS NULL`) | Collected on **every** offer for the academy (e.g. athlete name, age) | "Always asked" (read-only chips) |
| **EXTRA** | offer-scoped (`offer_id` + `section` set) | This **one offer's** extra questions | editable chips + "+ Add custom" |

This maps directly to the product framing: *"core data everyone needs + extra info you choose to
collect per offer."* A def with `offer_id IS NULL` is core; a def with `offer_id` set belongs to
that offer's Sales or Onboarding section.

### Axis B: section (WHEN a field is asked)

`custom_field_defs.section` is `'sales'` | `'onboarding'` | `NULL`.
- `sales` - asked on the offer's lead form.
- `onboarding` - asked when a member joins the offer.
- `NULL` - academy-level (core), asked everywhere.

---

## 3. Data model

### `custom_field_defs` - the catalog (migration `20260701130000`, offer scope `20260701160000`)

```
id            uuid pk
client_id     uuid  -> clients          (the academy that owns the field)
key           text                       (slug, unique per client_id)
label         text                       (display name)
type          text  check in (text, number, date, select, multiselect, boolean, phone, email, url)
options       jsonb                      (choices for select/multiselect; [] otherwise)
position      int                        (sort order within its scope)
required      bool
archived      bool                       (retire without deleting; reversible)
ghl_field_id  text                       (BRIDGE to a GHL custom field; NULL for portal-native)
offer_id      uuid  -> offers  (cascade) (NULL = academy-level/core; set = offer extra)
section       text  check in (sales, onboarding)   (NULL for academy-level)
created_at, updated_at
unique (client_id, key)
partial unique (client_id, ghl_field_id) where ghl_field_id is not null
index (offer_id, section)
```

### `contact_field_values` - the values (migration `20260701130000`)

```
id          uuid pk
contact_id  uuid -> contacts (cascade)   (the portal contacts.id, NOT ghl_contact_id)
field_id    uuid -> custom_field_defs (cascade)
value       jsonb                         (string / number / bool / array, per the def's type)
updated_at
unique (contact_id, field_id)
```

RLS on both: `select` = `is_staff() or client_id in (select my_client_ids())`; writes are
service-role (the API + webhooks use the service key). `contact_field_values` joins to `contacts`
for its client scope.

### Why `contacts.id`, not `ghl_contact_id`?

Values key on the **portal** `contacts.id` (see [`project_contacts_store.md`](../memories/project_contacts_store.md)).
`contacts` is the off-GHL system of record; `ghl_contact_id` is only a reconciliation bridge. A
member/lead resolves to its `contacts.id`, and that's what `contact_field_values.contact_id` points at.

---

## 4. End-to-end lifecycle

```
                         ┌─────────────────────────────────────────────────────────┐
   AUTHOR                │  custom_field_defs  (catalog: core = academy, extra = offer) │
                         └─────────────────────────────────────────────────────────┘
                              ▲                    ▲                         ▲
            staff Custom Fields tab      offer wizard "Info to collect"   GHL import
            (CustomFieldsView.jsx)       (_bbRenderCustomQuestions)       (?action=ghl-fields)

   CAPTURE   website form submit ──► writePortalFieldValues() ──► contact_field_values
             (api/website/leads.js)     (api/_contacts.js)          (keyed by ghl_field_id bridge)

   STORE                          contact_field_values  (typed value per contact+field)

   DISPLAY / EDIT   member drawer "Custom Fields" section  (_loadMemberCustomFields, client-portal.html)
                    reads GET ?action=values ; edits POST {action:'set-value'}

   USE      merge vars in messaging  ({{athlete_first_name}}, {{athletes_full_name}})
            (api/email-shells.js resolveMergeVars, fed by api/automations.js)
```

### The steps that got us here (PR history)

| Step | What | PR / migration |
|---|---|---|
| P4a schema | `custom_field_defs` + `contact_field_values` | #959, `20260701130000` |
| P4b tab | staff Custom Fields management tab | #960 |
| Import from GHL | `?action=ghl-fields` + `{action:'import-ghl'}` (adopt GHL fields, set `ghl_field_id`) | #964 |
| Value fold-in | `fold_custom_field_values(client_id)` SQL fn maps `contacts.custom_fields` blob -> typed values | #966, `20260701140000` |
| GTA seed | seeded GTA's working set with `ghl_field_id` + folded values | #970, `20260701150000` |
| Merge-var fix | `{{athletes_full_name}}` / `{{athlete_first_name}}` fed from resolved athlete name | #970, #977 |
| Offer scope | `offer_id` + `section` on defs | #973, `20260701160000` |
| Wizard builder | "Info to collect" panel in the offer wizard | #973 |
| GTA cleanup | collapse 4 name fields -> First/Last; archive non-question fields | #977, `20260701170000` |
| Attach to offer | GTA extras -> Training offer Sales section | #978, `20260701180000` |
| "Always collected" | read-only core chips in the wizard | #980 |
| Consolidation | one panel across all offer types; removed old `info_collect`/`reg_form_fields`/etc. | #982, #984 |
| Write loop | forms write values straight to the portal | #987 |
| Member drawer | show + edit values per contact | #988 |

---

## 5. API - `api/custom-fields.js`

Bearer-auth (`resolveUser` -> staff or `clientIds`), `canAccess(ctx, clientId)` = staff or owns the client.
Mirrors `api/action-items.js`. Service-role `sb()` for DB.

| Method | Query / body | Does |
|---|---|---|
| `GET ?client_id=` | + optional `offer_id`, `section`, `scope=academy` | List defs. Wizard reads (`offer_id` or `scope=academy`) **exclude archived**; the staff tab (no scope) shows archived dimmed. |
| `GET ?action=ghl-fields&client_id=` | | Live GHL custom fields, flagged if already imported |
| `GET ?action=values` | `contact_id` **or** `client_id`+`ghl_contact_id` | A contact's defs + current values → `{contact_id, fields:[{...def, value}]}` |
| `POST {action:'import-ghl'}` | `client_id`, field ids | Create defs from GHL (sets `ghl_field_id`) + `fold_custom_field_values` |
| `POST {action:'set-value'}` | `contact_id`, `field_id`, `value` | Upsert one value; empty value **clears** (deletes the row) |
| `POST` (create) | `client_id`, `label`, `type`, `options`, `offer_id?`, `section?` | New def (auto-slugged unique key) |
| `PATCH ?id=` | fields | Update a def |
| `DELETE ?id=` | | Delete a def (cascades its values) |

Helpers: `mapGhlType(dataType)` (GHL type → our type), `getGhlToken(client)` (refresh-aware),
`resolveContact(contactId | clientId+ghlContactId)`.

---

## 6. Frontend surfaces

### a) Staff Custom Fields tab - `src/views/CustomFieldsView.jsx` (React portal)
Academy picker + field list (archived dimmed) + add/edit modal (9 types) + "Import from GHL" modal.
Nav-gated to `admin` / `scaling_manager` in `src/App.jsx`.

### b) Offer wizard "Info to collect" panel - `public/client-portal.html`
`_bbRenderStepFields` appends `_bbRenderCustomQuestions(offer, sectionId)` on the **Sales** and
**Onboarding** steps of every standard offer type (gated `!_bbIsV1()`; **Team** uses a separate
per-team renderer and is not covered). The panel:
- **Always asked** (read-only chips): base contact (Name/Email/Phone) + academy core defs
  (`_bbLoadCoreFields` → `GET ?scope=academy`).
- **Optional** (editable chips + "+ Add custom"): this offer's defs
  (`_bbLoadCustomQuestions` → `GET ?offer_id=&section=`). Add opens a modal (`_bbCqOpenAdd` →
  `_bbCqSave` POSTs a def with `offer_id`+`section`); the × removes (`_bbCqDelete`).
- Uses the wizard's own `bb-choice` chip styling; async re-render mirrors the Team builder
  (`_bbRenderWizardBody`). Caches: `_bbCqCache` (offer), `_bbCqCoreCache` (academy).

This panel **replaced** the old per-type `check_many_defaults` fields (`info_collect`,
`reg_form_fields`, `team_reg_form`, `individual_reg_form`, `inquiry_form_fields`,
`intake_form_fields`) which wrote to unused `offers.data`. Do not reintroduce those.

### c) Member drawer Custom Fields - `public/client-portal.html`
`_renderMemberModalBody` renders a "Custom Fields" section (after Billing). `_loadMemberCustomFields(m)`
→ `GET ?action=values&client_id=&ghl_contact_id=` → `_renderMemberCF` renders each field
inline-editable by type (`_memberCFInput`: text/number/date input, select dropdown, multiselect
checkboxes, boolean Yes/No). Edits POST `{action:'set-value'}` via `_memberCFSave` (with a "Saved"
flash); multiselect via `_memberCFToggleMulti`. State in `_MEMBER_CF = { contactId, byId }`.

---

## 7. Off-GHL status + the `ghl_field_id` bridge

### The write loop (portal-native capture) - `api/_contacts.js` `writePortalFieldValues()`
On a website form submit, `api/website/leads.js` calls (right after `upsertPortalContact`):
```
writePortalFieldValues(clientId, portalContactId, fieldMap, fields)
```
It loads the client's **active** defs that have a `ghl_field_id`, and for each `entry_points.field_map`
entry (`submissionKey -> ghlFieldId`) with a value, resolves `ghlFieldId -> def` and upserts
`contact_field_values` (type-coerced; archived defs skipped). So values land in the portal in real
time - the portal no longer depends on the GHL sync + `fold_custom_field_values` to hold a lead's data.

GHL still gets its copy via `pushToGhl` (dormant) because `contact_provider` is still `'ghl'` and the
contact must exist in GHL for inbound threading. That copy turns off at the `contact_provider='portal'`
flip - no code change, just the flag (see `project_contacts_store.md`).

### The `fold_custom_field_values(client_id)` SQL fn (migration `20260701140000`)
Maps `contacts.custom_fields` (the opaque GHL blob, keyed by GHL field id) onto imported defs (by
`ghl_field_id`) into typed `contact_field_values`. Idempotent; run after `import-ghl`. This is the
**backfill** path; the write loop is the **live** path.

### Merge vars - `api/email-shells.js` `resolveMergeVars(html, L, vars)`
Supports (fed by `api/automations.js` and the agents):
- `{{contact.first_name}}` / `{{contact.full_name}}` - the contact (parent) name.
- `{{contact.athletes_full_name}}` / `{{contact.athlete_full_name}}` = `vars.athlete` (the athlete
  name, from `ghl_contacts.athlete_name`, produced by the **athlete-name resolver**).
- `{{contact.athlete_first_name}}` / `{{contact.athletes_first_name}}` = first token of the athlete
  full name (for casual copy: "Hey Jordan").

**Athlete-name resolver:** `clients.v15_config.athlete_name_field_ids` is an ordered list of GHL
custom-field ids; `api/ghl/cron-sync-contacts.js` takes the first non-empty into
`ghl_contacts.athlete_name` (the GHL contact is usually the PARENT; the kid's name lives in a custom
field). Used by roster / inbox / agent + the merge vars above.

---

## 8. BAM GTA specifics

GTA's clean set after the 2026-07-01 cleanup:

| Field | Type | Scope | `ghl_field_id` |
|---|---|---|---|
| Athlete's First Name | text | core (academy) | `LkEMio…` |
| Athlete's Last Name | text | core (academy) | `shug52…` |
| Athlete's Age | number | core (academy) | `YV4VHW…` |
| Are You Close to Oakville? | multiselect | extra (Training offer, Sales) | `8npLyk…` |
| When would you be able to start training? | select | extra (Training offer, Sales) | `9LyXPR…` |

**Archived** (reversible, still in `custom_field_defs` with `archived=true`): Athlete's Full Name +
Player Full Name (collapsed into First/Last by splitting on first space, migration `20260701170000`),
Free Trial Date (booking data), Did-athlete-show-up + Lead Sales Person (post-trial form writes to GHL
directly), Inquiry (freeform message). These are **not** custom questions; the live post-trial/booking
flows don't read the portal defs, so archiving them is safe.

GTA constants: `client_id = 39875f07-0a4b-4429-a201-2249bc1f24df`, Training offer
`52a6285c-7832-44e1-b531-ab7ef9d8fc21`, `ghl_location_id = Le9phlhqKyjLyd0JTECv`.

---

## 9. Gotchas & known limitations

- **Brand-new wizard questions with no `ghl_field_id` aren't captured by live forms yet.** The write
  loop keys on the `ghl_field_id` bridge (because `entry_points.field_map` maps to GHL field ids). A
  portal-only question (added in the wizard, no GHL field) has nowhere in the form to be filled from.
  Closing this needs a forms enhancement: let `field_map` map submission keys → **def ids** directly.
- **Team offers** don't get the wizard panel (separate `_bbRenderTeamPerTeam` renderer).
- **Archived vs deleted:** archiving (`archived=true`) hides a def from the wizard + capture but keeps
  it + its values; deleting cascades values away. Prefer archive.
- **Value shape:** `contact_field_values.value` is jsonb - string (text/select/date), number, bool, or
  array (multiselect). The drawer + write loop coerce by `def.type`; keep new consumers type-aware.
- **`?action=values`** returns only **non-archived** defs (that's what the drawer wants).
- **Never re-add** the old `info_collect` / `reg_form_fields` / `intake_form_fields` config fields -
  they were the pre-consolidation UI and wrote to dead `offers.data`.

---

## 10. File map

```
bam-portal/
├── api/
│   ├── custom-fields.js              CRUD + values API + GHL import/fold trigger
│   ├── _contacts.js                  upsertPortalContact + writePortalFieldValues (the write loop)
│   ├── website/leads.js              form handler; calls writePortalFieldValues
│   ├── email-shells.js               resolveMergeVars (athlete first/full name tokens)
│   └── automations.js                feeds the athlete merge var into sends
├── src/
│   ├── views/CustomFieldsView.jsx    staff Custom Fields tab
│   └── App.jsx                       nav gate (admin/scaling_manager)
├── public/client-portal.html
│   ├── _bbRenderCustomQuestions      offer-wizard "Info to collect" panel
│   ├── _bbLoadCustomQuestions/_bbLoadCoreFields/_bbCq*   wizard load/add/delete
│   └── _renderMemberModalBody + _loadMemberCustomFields/_memberCF*   member-drawer display/edit
└── supabase/migrations/
    ├── 20260701130000_custom_field_defs.sql              defs + values tables
    ├── 20260701140000_fold_custom_field_values.sql       blob → typed values fn
    ├── 20260701150000_seed_gta_custom_fields.sql         GTA working-set seed
    ├── 20260701160000_custom_field_defs_offer_scope.sql  offer_id + section
    ├── 20260701170000_gta_collapse_name_fields.sql       4 name fields → First/Last
    └── 20260701180000_gta_attach_extras_to_offer.sql     extras → Training offer Sales
```

---

## 11. When to update this doc

- New field type added to `type` check → update §3 + the drawer/wizard renderers.
- New scope/section semantics → update §2.
- The write loop changes (e.g. def-id `field_map`) → update §7 + §9.
- Team offers get the panel, or onboarding-intake consolidation lands → update §6.
- The `contact_provider` flip happens (GHL copy write turns off) → update §7.

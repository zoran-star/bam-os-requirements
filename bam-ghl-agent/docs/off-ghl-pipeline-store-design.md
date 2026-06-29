# Off-GHL Pipeline Store — Design (Effort "E", the keystone)

**Goal:** make the portal the **system-of-record** for the BAM GTA sales board so GHL can
eventually be turned off. Today every opportunity *is* a GHL object, every stage is a GHL
pipeline stage found by name-regex, and every move is a `PUT /opportunities/{id}`. This doc
specifies the Supabase store that replaces that, plus a phased, production-safe cutover.

> Tier rule (repo HARD RULE): **V1 academies stay on GHL, untouched.** Everything here is
> gated so V1/V1.5 behavior is byte-identical until an academy is explicitly flipped. GTA
> (`client_id = 39875f07-0a4b-4429-a201-2249bc1f24df`, V2) is the first and only flip target.

---

## 1. Today's reality (audit) — how the board works now

```
STAGE ROLE          GHL stage (found by regex in api/agent/_stage.js)   spine label
responded           /respond/i                                          📞 Booking
interested          /interest/i                                         👻 Ghosted
scheduled_trial     /(schedul|book).*trial/i                            ✅ Confirm
done_trial          trial + (done|complete|attend)                      🎯 Closing
nurture             /nurtur/i (may not exist yet)                       💔 Lead Nurture
won                 GHL status='won' (set inside a GHL workflow)         🎉 Member
unqualified         GHL status='abandoned' + `unqualified` tag          🚫 Unqualified
```

- The **board** is read live from GHL per request (`api/ghl/pipelines.js` GET), assembled from
  `GET /opportunities/pipelines` + a paginated `GET /opportunities/search` per pipeline, then
  enriched from our own tables (`members`, `website_leads`, `post_trial_reviews`, calendar events).
- **Stage finders** all re-fetch `/opportunities/pipelines` and pick a stage by regex. There is
  **no portal record of which stage is which** — the role↔stage mapping is recomputed every call.
- The **only** portal-side persistence today is `pipeline_outcomes` (an append-only audit of
  won/lost/abandoned/nurture/ghosted with a free-text reason). It is NOT a source of truth.
- Contacts are mirrored **read-only** into `ghl_contacts` by `api/ghl/cron-sync-contacts.js`.
- **"Won" is owned by GHL**, not the portal: `fireOnboardingActivations` (activations.js) enrolls
  the paid contact into a GHL workflow whose action steps mark the opp won. So off-GHL also needs
  the portal to own the WON transition.

### Save-first precedent we are extending
`website_leads` is already "save-first": our DB is truth, GHL is a mirror we can unplug per client
(`project_website_leads.md`). The messaging spine (migration `20260629150000`) already introduced a
**provider-agnostic own-store** (`sms_threads`/`sms_messages`) with a per-academy `messaging_provider`
toggle and a `ghl_contact_id` bridge column so the board/agents keep working after cutover. **This
design follows the exact same shape** for opportunities/pipeline.

---

## 2. Call-site inventory — every place an opp is created / read / moved / closed

`PUT /opportunities/{id}` = stage move or status change. `POST /opportunities/` = create.
`GET /opportunities/search|pipelines` + the `_stage.js` finders = reads.

| # | File:line | Op | What it does | Role(s) |
|---|---|---|---|---|
| **READ — the board** |
| 1 | `api/ghl/pipelines.js:424` | READ | board: `GET /opportunities/pipelines` | all |
| 2 | `api/ghl/pipelines.js:435-452` | READ | board: paginated `GET /opportunities/search?status=open` per pipeline | all |
| 3 | `api/ghl/pipelines.js:243,297,391` | READ | fetch one opp (contact, status) for moves/convert | — |
| 4 | `api/ghl/all-pipelines.js:38,46` | READ | staff cross-academy pipeline roll-up | all |
| 5 | `api/kpis-v15.js:295` | READ | KPI counts per pipeline | all |
| 6 | `api/offers/kpi-setup.js:191` | READ | list pipelines for KPI config UI | all |
| **READ — stage finders (`api/agent/_stage.js`)** |
| 7 | `_stage.js:13` `respondedStage` | READ | regex `/respond/i` | responded |
| 8 | `_stage.js:25` `interestedStage` | READ | regex `/interest/i` | interested |
| 9 | `_stage.js:40` `scheduledTrialStage` | READ | regex `(schedul\|book).*trial` | scheduled_trial |
| 10 | `_stage.js:57` `nurtureStage` | READ | regex `/nurtur/i` (nullable) | nurture |
| 11 | `_stage.js:213` `doneTrialStage` | READ | regex trial+done/complete/attend | done_trial |
| 12 | `_stage.js:66-276` | READ | `contactInRespondedStage`, `computeQueue`, `respondedContactIdSet(+Cached)`, `computeConfirmQueue`, `scheduledTrialContactIdSet(+Cached)`, `computeClosingQueue`, `doneTrialContactIdSet(+Cached)` — all do `GET /opportunities/search` to derive who's in a stage | responded / scheduled_trial / done_trial |
| **Consumers of the finders** (7 files): `agent-approvals.js`, `agent-confirm.js`, `agent-closing.js`, `automations.js`, `ghl/inbound-webhook.js`, `agent/_tags.js`, `ghl/pipelines.js` |
| **MOVE / CLOSE — stage changes + status** |
| 13 | `api/ghl/pipelines.js:247,259,279` | MOVE/CLOSE | PATCH endpoint: move opp, or set status won/lost/abandoned; `lost` → nurture-route if `isAutomationLive(nurture)` | all roles |
| 14 | `api/website/leads.js:241` | CREATE | `POST /opportunities/` create card from a website form | responded/interested |
| 15 | `api/website/leads.js:232` | MOVE | move existing card on booking (`placeOpportunity advance=true`) | scheduled_trial |
| 16 | `api/ghl/post-trial.js:185` | MOVE | no-show → Interested | interested |
| 17 | `api/ghl/post-trial.js:199` | MOVE | good-fit → Done Trial | done_trial |
| 18 | `api/agent-approvals.js:795` | MOVE | confirm-lost → nurture stage (if live) | nurture |
| 19 | `api/agent-approvals.js:802` | CLOSE | confirm-lost → `status:lost` (fallback) | lost |
| 20 | `api/agent-approvals.js:834` | CLOSE | confirm-abandoned → `status:abandoned` (+ unqualified tag) | unqualified |
| 21 | `api/agent-approvals.js:925` | MOVE | confirm-ghost → Interested (enroll ghosted) | interested |
| 22 | `api/agent-confirm.js:730` | MOVE | confirm "can't make it" → Responded (rebook) | responded |
| 23 | `api/agent-confirm.js:764` | MOVE | confirm-lost → nurture stage (if live) | nurture |
| 24 | `api/agent-confirm.js:771` | CLOSE | confirm-lost → `status:lost` | lost |
| 25 | `api/agent-closing.js:722` | MOVE | closing-lost → nurture stage (if live) | nurture |
| 26 | `api/agent-closing.js:729` | CLOSE | closing-lost → `status:lost` | lost |
| 27 | `api/automations.js:226` | MOVE | ghosted ran out → nurture stage + enroll nurture | nurture |
| 28 | `api/ghl/inbound-webhook.js:235` | MOVE | reply → Responded (booking picks up warm) | responded |
| **WON (owned by GHL today, must move to portal)** |
| 29 | `api/onboarding/activations.js` (GHL workflow) | CLOSE | paid member → GHL workflow marks opp **won** | won |

**Surface area: 7 stage finders + ~16 move/close PUTs + 2 board readers + 1 create + WON-via-workflow,
spread over ~10 files.** The store must intercept all of them behind one provider switch.

---

## 3. Supabase schema

Two new tables. Follows the established RLS pattern (`is_staff() OR client_id in (select
my_client_ids())` for SELECT; **all writes go through the service-role API**, which enforces rules)
and the `ghl_*_id` bridge-column pattern from the messaging spine.

### 3.1 `pipeline_stages` — the stage-role registry (kills the name-regex coupling)

One row per (academy, pipeline, role). Code asks the registry for "the responded stage for this
academy" instead of regex-matching GHL names. Seeded from GHL once; thereafter portal-owned.

```sql
-- Stage-role registry: maps a stable ROLE (what the code means) to a concrete
-- stage for one academy, decoupling agents/board from GHL stage NAMES. Seeded
-- from GHL during cutover P1; the source of truth once an academy is flipped.
create table if not exists public.pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  role            text not null check (role in (
                    'responded','interested','scheduled_trial','done_trial',
                    'nurture','won','unqualified')),
  label           text,                       -- display name e.g. "📞 Booking"
  position        int  not null default 0,    -- board column order
  -- GHL reconciliation: which GHL pipeline+stage this role currently maps to.
  -- Lets P1 dual-write and lets the finders return GHL ids while still on GHL.
  ghl_pipeline_id text,
  ghl_stage_id    text,
  ghl_stage_name  text,
  is_terminal     boolean not null default false,  -- won / unqualified
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, role)
);
create index if not exists pipeline_stages_client_idx on public.pipeline_stages(client_id);

alter table public.pipeline_stages enable row level security;
create policy pipeline_stages_select on public.pipeline_stages
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy pipeline_stages_write on public.pipeline_stages
  for all using (is_staff()) with check (is_staff());

comment on table public.pipeline_stages is
  'Per-academy stage-role registry. Decouples code from GHL stage names: finders resolve a ROLE to a stage here instead of regex-matching GHL. ghl_* columns reconcile to GHL while still dual-writing.';
```

### 3.2 `opportunities` — the portal-owned opportunity store

One row per lead's run through the sales pipeline. `ghl_opportunity_id` is the bridge for
reconciliation + dual-write; `ghl_contact_id` ties to the existing contacts mirror + agents.

```sql
-- Portal-native opportunity store: the system-of-record for the sales board once
-- an academy is flipped to provider='portal'. While on GHL it is a shadow mirror
-- (dual-written) for safe cutover. Mirrors the messaging-spine own-store pattern.
create table if not exists public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,

  -- Who: link to contact + member. ghl_contact_id keeps board+agents working.
  ghl_contact_id       text,
  contact_phone        text,                  -- E.164, bridges to sms_threads
  contact_name         text,
  athlete_name         text,
  member_id            uuid references public.members(id) on delete set null,

  -- Where in the pipeline: ROLE is the contract; stage_id points at the registry.
  stage_role           text not null default 'responded' check (stage_role in (
                         'responded','interested','scheduled_trial','done_trial',
                         'nurture','won','unqualified')),
  stage_id             uuid references public.pipeline_stages(id) on delete set null,

  -- Open/closed lifecycle, independent of stage (a lead can be lost from any stage).
  status               text not null default 'open' check (status in (
                         'open','won','lost','abandoned')),

  -- Provenance.
  source               text,                  -- 'website-form' | 'agent' | 'import' | 'manual'
  entry_point          text,                  -- 'contact' | 'free-trial' | 'ghl-import' | ...
  monetary_value       numeric default 0,
  reason               text,                  -- free-text close reason (won/lost/abandoned)

  -- Reconciliation with GHL (the bridge; null once GHL is fully off).
  ghl_opportunity_id   text,
  ghl_pipeline_id      text,

  -- Timeline.
  last_stage_change_at timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- One portal opp per GHL opp (idempotent dual-write + import).
  unique (client_id, ghl_opportunity_id)
);
create index if not exists opportunities_client_stage_idx
  on public.opportunities(client_id, stage_role, status);
create index if not exists opportunities_contact_idx
  on public.opportunities(client_id, ghl_contact_id);
create index if not exists opportunities_phone_idx
  on public.opportunities(client_id, contact_phone);
-- Fast "who is open in this role" (replaces the GHL search the finders do).
create index if not exists opportunities_open_role_idx
  on public.opportunities(client_id, stage_role) where status = 'open';

alter table public.opportunities enable row level security;
create policy opportunities_select on public.opportunities
  for select using (is_staff() or client_id in (select my_client_ids()));
create policy opportunities_write on public.opportunities
  for all using (is_staff()) with check (is_staff());

comment on table public.opportunities is
  'Portal-native opportunity store (system-of-record for the sales board on provider=portal). While on GHL it shadow-mirrors via dual-write; ghl_opportunity_id reconciles. stage_role is the code contract, stage_id points at pipeline_stages.';
```

### 3.3 The provider toggle (mirrors `messaging_provider`)

```sql
alter table public.clients
  add column if not exists pipeline_provider text not null default 'ghl';
do $$ begin
  alter table public.clients add constraint clients_pipeline_provider_chk
    check (pipeline_provider in ('ghl','portal'));
exception when duplicate_object then null; end $$;
comment on column public.clients.pipeline_provider is
  'System-of-record for the sales board: ''ghl'' (default) or ''portal'' (own opportunities store). Flip to ''portal'' only after dual-write has backfilled and reconciled. V1/V1.5 stay ''ghl''.';
```

**Why a role registry instead of just columns:** the entire fragility today is that `responded`,
`interested`, etc. are discovered by regex on GHL names every call. The registry makes the
role→stage mapping **one stored fact per academy**, editable in the existing Entry-Points / Train
UI, and survivable when GHL is gone (the `ghl_*` columns just go null).

---

## 4. Phased cutover (production-safe, V1 untouched)

Each phase ships behind the `pipeline_provider` flag (default `'ghl'`). A small shared module
`api/pipeline/_store.js` becomes the single seam: `resolveStage(role)`, `moveOpp(id, role)`,
`closeOpp(id, status, reason)`, `createOpp(...)`, `readBoard(clientId)`. Internally it branches on
`pipeline_provider`. Callers stop talking to GHL directly and talk to the seam.

### P1 — Tables + registry + dual-write (flag stays `ghl`)

**Goal:** every existing GHL move/create/close ALSO writes Supabase. Reads still come from GHL.
Zero behavior change.

- **New:** migration (3.1 + 3.2 + 3.3); `api/pipeline/_store.js`; `api/pipeline/seed-stages.js`
  (one-shot: read `/opportunities/pipelines`, upsert a `pipeline_stages` row per role using the
  existing regexes, fill `ghl_*`); a backfill that imports current open opps from GHL into
  `opportunities` (idempotent on `ghl_opportunity_id`).
- **Change:** wrap the 16 move/close PUTs + the 1 create (sites #13-28 + #14) so each, after its
  GHL call succeeds, upserts the matching `opportunities` row (`ghl_opportunity_id` key) and stamps
  `stage_role`, `status`, `last_stage_change_at`. `pipeline_outcomes` already logs closes; reuse
  that write to also upsert `opportunities.status`.
- **Gate:** dual-write is unconditional (it only writes a shadow table; GHL stays truth). Safe for
  V1.5 too because nothing reads the shadow yet. Optional `DUAL_WRITE_PIPELINE` env kill-switch.
- **Rollback:** stop writing (revert) or `truncate opportunities` — GHL is untouched.
- **V1-safe:** writes only; no read path changed.

### P2 — Switch board read + stage finders to Supabase (flag = `portal`, GTA only)

**Goal:** for a flipped academy, the board and the finders read from `opportunities` /
`pipeline_stages` instead of GHL.

- **Change `_stage.js`:** each finder checks `pipeline_provider`. `portal` → return the registry
  row (`{ pipelineId, stageId }` still shaped the same, sourced from `pipeline_stages.ghl_*` or the
  portal id). The `contactIdSet` / `computeQueue` helpers → query `opportunities` (`where stage_role
  = X and status='open'`) instead of `GET /opportunities/search`. Same return shapes, so the 7
  consumer files don't change.
- **Change `ghl/pipelines.js` GET:** `portal` → assemble the board from `opportunities` +
  `pipeline_stages` (keep the same enrichment from `members`/`website_leads`/`post_trial_reviews`).
  `ghl` → unchanged.
- **Gate:** `pipeline_provider === 'portal'`. Keep dual-write ON (writes still hit GHL too) so a
  rollback to `ghl` reads a still-current GHL.
- **Rollback:** flip the flag back to `ghl` — instant, because dual-write kept GHL live.
- **V1-safe:** V1/V1.5 academies are `ghl`, read path identical.

### P3 — Entry points create PORTAL opportunities

**Goal:** new leads originate in the portal store, not GHL.

- **Change `website/leads.js`:** when `portal`, `placeOpportunity` / `maybePortalRoute` insert an
  `opportunities` row (source `website-form`, entry_point = form_type) and set `stage_role` from the
  registry, instead of `POST /opportunities/`. Dual-write still mirrors to GHL during transition.
- **Change `post-trial.js`, agent move sites:** already wrapped by `_store.moveOpp` in P1; under
  `portal` they update the portal row as truth and (until P4) still PUT GHL.
- **Gate:** flag. **Rollback:** flag back. **V1-safe:** gated.

### P4 — Turn GHL writes off + own WON

**Goal:** stop calling GHL for moves/creates/closes; portal is sole truth.

- **Change `_store.js`:** under `portal`, skip the GHL PUT/POST entirely (registry no longer needs
  `ghl_*`). Stop the dual-write.
- **WON (#29):** move the win into the portal — `fireOnboardingActivations` (or the Stripe webhook)
  sets `opportunities.status='won'` directly instead of relying on the GHL workflow's "mark won"
  step. (The enroll→pay→member machinery already exists; only the won-write relocates.)
- **Contacts:** `cron-sync-contacts` can stop, OR keep running read-only until contacts also move
  off GHL (separate effort). Board no longer depends on GHL being reachable.
- **Gate:** flag. **Rollback:** hardest here — flipping back to `ghl` after GHL writes stopped means
  GHL is stale. Mitigate by keeping dual-write through a soak period and only dropping it once
  reconciliation (a cron diffing `opportunities` vs GHL) is clean for N days.
- **V1-safe:** V1 never reaches `portal`.

---

## 5. Hard interactions with the other efforts

### Effort F — Inbound webhook (replaces GHL inbound for messaging)
- **Needs from this store:** a way to resolve "which open opportunity / stage_role is this contact
  in" without GHL — i.e. the `opportunities` lookup by `ghl_contact_id` / `contact_phone`. Site #28
  (reply → Responded) currently does a `GET /opportunities/search`; under `portal` it becomes an
  `opportunities` update keyed on contact.
- **Gives F:** the `contact_phone` + `ghl_contact_id` bridge columns line up with `sms_threads`, so
  an inbound SMS (Twilio) can find the lead's opp and move it. **Keep the bridge columns identical
  in spelling** so the two own-stores join cleanly.

### Effort G — Calendar (replaces GHL appointments)
- **Needs from this store:** the `scheduled_trial` stage role + the opp to advance when a trial is
  booked (today `website/leads.js` booking path + `post-trial.js`). When calendar moves off GHL, the
  booking event must call `_store.moveOpp(oppId, 'scheduled_trial')` instead of advancing a GHL card.
- **Gives G:** `opportunities.stage_role` is the single place to record "booked / attended /
  no-show" transitions; the calendar effort writes through the same seam rather than GHL custom
  fields. `trialDate` enrichment (currently from GHL calendar events) moves to a portal field.

> Shared rule for E/F/G: all three are "own-store + per-academy provider flag + `ghl_*` bridge
> column" following the messaging spine. Keep the flags independent (`messaging_provider`,
> `pipeline_provider`, and a future `calendar_provider`) so an academy can move one rail at a time.

---

## 6. Effort estimate + recommended first PR

**Rough size: ~6-8 PRs.**

| PR | Scope | Size |
|---|---|---|
| 1 | Migration (both tables + flag) + `seed-stages.js` + `_store.resolveStage()`; wire `_stage.js` finders to the registry under a read-through that still returns GHL ids (no behavior change) | **S** ← start here |
| 2 | Dual-write: wrap the 16 move/close PUTs + the create through `_store`, upsert `opportunities` | M |
| 3 | GHL→portal backfill of current open opps + a reconciliation cron (diff portal vs GHL) | M |
| 4 | Board read from Supabase under `portal` (pipelines.js GET) | M |
| 5 | Finders/queues read from `opportunities` under `portal` | M |
| 6 | Entry points create portal opps under `portal` | S |
| 7 | Own WON + stop GHL writes + stop dual-write (after soak) | M |
| 8 | (with F/G) inbound + calendar write through `_store` | M |

### Recommended first PR (smallest safe slice)
**PR 1 — the registry + the seam, no behavior change.**
1. Ship the migration: `pipeline_stages`, `opportunities`, `clients.pipeline_provider` (default `ghl`).
2. Ship `api/pipeline/seed-stages.js` and run it for GTA to populate the 7 role rows (with `ghl_*`).
3. Introduce `api/pipeline/_store.js resolveStage(client, role)` and make the 7 `_stage.js` finders
   delegate to it. Under `pipeline_provider='ghl'` it returns the **same GHL ids the regex returns
   today** (it can even fall back to the live regex if a registry row is missing), so production is
   byte-identical — but the coupling to GHL stage *names* is now broken and the store exists for
   every later phase to build on.

This is purely additive: a new table, a seed script, and an indirection that returns today's values.
Nothing reads the new opportunities table yet, nothing writes to GHL differently. Maximum safety,
and it unblocks PR 2's dual-write immediately.

---

## 7. Risks (biggest first)

1. **Reconciliation drift during dual-write.** If a GHL PUT succeeds but the Supabase upsert fails
   (or vice-versa), the shadow diverges. Mitigate: idempotent upserts keyed on `ghl_opportunity_id`,
   a reconciliation cron (PR 3) that diffs and heals, and only flip a role to `portal`-read after the
   diff is clean.
2. **WON ownership relocation (#29).** Won is currently a *side effect of a GHL workflow*, not portal
   code. Missing this in P4 means paid members never show as 🎉 Member on a portal-read board. Must
   explicitly move the won-write into `fireOnboardingActivations`/Stripe webhook.
3. **Hidden GHL-shaped assumptions in the board UI.** `client-portal.html` reads the GHL board JSON
   shape (`pipelines[].stages[].opportunities[]`, `pipelineStageId`, `lastStageChangeAt`,
   `expectsTrial`, member/trainer enrichment). The portal-read board MUST emit the identical shape or
   the V2 board (glows, duplicate detector, ghost badges) breaks. Keep `pipelines.js` GET as the one
   shaper for both providers.
4. **Stage finders feed 7 files incl. live agents.** Any change to the finder return shape ripples
   into Booking/Confirm/Closing detectors and the inbound webhook. Preserve `{ pipelineId, stageId,
   stageName }` + the `Set<contactId>` shapes exactly (P2 keeps them).
5. **Rollback after GHL writes stop (P4).** Once dual-write is off, GHL goes stale; flipping back is
   no longer instant. Gate P4 behind a clean-reconciliation soak and keep dual-write longer than feels
   necessary.
6. **Contacts still in GHL.** This effort moves opportunities, not contacts. `opportunities` leans on
   `ghl_contact_id`; until contacts also move off GHL (separate effort) the academy isn't *fully*
   off GHL even after P4. Bridge columns (`ghl_contact_id`, `contact_phone`) are deliberately kept.
7. **Nurture stage may not exist in GHL.** `nurtureStage` returns null today for academies that
   haven't created it. The registry fixes this (a portal role can exist without a GHL stage), but P1
   seeding must tolerate a missing GHL nurture/won stage (leave `ghl_*` null, role row still created).

# Sales Focus Mode (V2) — design spec (locked 2026-07-05)

## ▶ NEXT SESSION — START HERE (state @ 2026-07-06)

**LIVE ON GTA PROD** (deployed 2026-07-06, PR #1178 → main): V2 Sales **overview**
(KPI row + collapsed stage strip + expand/single-stage takeover) **and** **focus mode**
(per-stage config: stacked Entry→Engine→Exit; engine reuses the real Train Agent
renderers `_taRenderPanel`/`_taRenderAutomations` = live agents + automations). All in
`bam-portal/public/client-portal.html`, V2-gated + additive. Verify: portal.byanymeansbusiness.com → GTA → Sales.

**`stage_transitions` table LIVE** (prod migration `20260706122103`) + **GTA seeded** with
the 20-edge Sales-Crew flow. Enums `transition_trigger`/`stage_role`/`transition_destination_kind`;
edge-per-row (`from_stage_role, trigger, to_kind, to_stage_role|to_terminal`), client-scoped RLS,
`seed_default_stage_transitions(client_id)`. Design: `docs/core-handoff/sales-flow.md`.

**✅ DONE 2026-07-06 (this session):** focus-mode **Entry/Exit now read the real
`stage_transitions` edges** per stage + **Exit is fully editable** (CRUD). In
`client-portal.html`: `_plEdgesEnsure()` loads edges via `_sb` (client-scoped RLS,
`stage_transitions_rw` = is_staff OR my_client_ids, so the logged-in client can CRUD);
`_plStageRole(name)` maps GHL stage → role (booking→responded, confirm→scheduled_trial,
closing→done_trial, ghosted→interested, nurture→nurture). Entry section = read-only
(each chip = another stage's exit, with a "Configure {source}" jump); Exit section =
editable rows (toggle `enabled`, edit trigger+destination, delete) + "Add exit branch"
inline form. One-destination-per-trigger enforced in UI; DB unique/check constraints +
23505 handled. Inserts use `pipeline_id=null` (client-wide flow), `is_seed=false`.
Helpers/handlers: `_plRenderEntrySec`/`_plRenderExitSec`/`_plEdgeFormHtml`/`_plEdgeAdd`/
`_plEdgeEdit`/`_plEdgeFormSave`/`_plEdgeToggle`/`_plEdgeDelete` + `_plFocusRerender`.

**🚧 ROUTER — IN PROGRESS (Phase 1+2 done 2026-07-06, PR #1189):** goal = scale to more
academies, so leads move by the academy's authored edges, not hardcoded per-agent logic.
- **`api/agent/_router.js` built (Phase 1):** `resolveEdge(clientId, fromRole, trigger)` reads
  the edge on the client-wide flow (`pipeline_id IS NULL`) via `sbRest` (now exported from
  `_store.js`); `routeTransition({...})` resolves + moves using the existing `_store` primitives
  (`resolveStage` + `moveStage`, so it inherits the ghl/portal provider split + shadow mirror +
  KPI hooks). **Additive/safe:** no edge / lookup blip → `{matched:false}` → caller runs its
  hardcoded move. **Terminals (member/unqualified/human) DEFER** to hardcoded close logic this
  phase — router only does stage→stage moves.
- **Pause semantics (2026-07-06):** `resolveEdge` no longer filters `enabled=true` — it returns
  the row incl. its `enabled` flag so the router can tell a PAUSED route (enabled=false → row
  exists) from an ABSENT one (null). `routeTransition` on a paused edge returns
  `{matched:true, moved:false, paused:true}` → caller skips BOTH the move and the hardcoded
  fallback, so **pausing an edge in focus mode now actually stops that move**. Editing a
  destination already worked (router returns the new dest). **DELETE still doesn't take effect**
  (a deleted row is indistinguishable from unseeded → fallback fires) — only becomes real at
  Phase 4 when fallbacks are removed. GTA unaffected (all edges enabled).
- **Swaps DONE (all stage→stage, each keeps old move as matched:false fallback, GTA-identical):**
  #1 `went_quiet` responded→interested (`agent-approvals.js` confirm-ghost) ·
  #2 `booked` responded→scheduled_trial (`agent-approvals.js` booking; `kpiTrialBooked` fires
  either path so KPI unaffected) ·
  #3 `cant_make_it` scheduled_trial→responded (`agent-confirm.js` confirm-handoff rebook) ·
  #4 `ghosted_ran_out` interested→nurture (`automations.js` seq-complete; covers ghosted +
  summer_special; nurture-off LOST branch untouched) ·
  #5 `not_interested` responded→nurture (`agent-approvals.js` confirm-lost; nurture-live-gated,
  paused→falls through to LOST, enroll + routedToNurture preserved) ·
  #6 `says_no` done_trial→nurture (`agent-closing.js` confirm-lost; same shape as #5).
  → **Every straightforward stage→stage move in portal code is now routed.** Shipped in one
  session (2026-07-06, PR #1189) — NOT yet prod-verified on GTA; verify the batch before Phase 3+.
- **TERMINAL PATH BUILT (2026-07-06):** `routeTransition` handles terminal edges when the caller
  passes **`allowTerminal:true`** (opt-in, so the 6 stage-swap callers are unaffected + an academy
  re-pointing a stage trigger at a terminal can't make a stage-only caller mis-close a lead).
  member→`setStatus(won)` · unqualified→`setStatus(abandoned, role:unqualified)` (mirrors
  confirm-abandoned's core close) · human→NO status change, returns `{escalate:true}` for the
  caller. GHL tag / outcome-log side effects stay caller-side.
- **POST-TRIAL FORM (`api/ghl/post-trial.js`) — 2 of 3 done:**
  - ✅ `post_trial_good_fit` scheduled_trial→done_trial — routed (stage), provider-branch fallback,
    GTA-identical.
  - ✅ `post_trial_not_fit` → **Unqualified** — was a NO-OP (not-a-fit leads stranded in Scheduled
    Trial); now closes via the terminal path (`allowTerminal:true`) + stamps unqualified tag +
    outcome row (mirrors confirm-abandoned). Fires on `showed_up===true && !good_fit`. Quiet close.
    NEW behavior (Zoran-approved).
  - ⏸️ `no_show` — **DECISION: Zoran wants → Responded (NOT the current code's → Interested), WITH
    an initial automation.** BLOCKED on the new model below + reconciling the existing `missed_trial`
    automation (today fired on no-show; it assumes the Interested/Ghosted path — can't also send
    the lead to Responded for the booking agent without double-touch). NOT changed yet.
- **🧭 INITIAL AUTOMATIONS PER ENTRY POINT (Zoran model, 2026-07-06) — DESIGNED + Phase A BUILT.**
  Design doc: [`docs/initial-automations-design.md`](../docs/initial-automations-design.md).
  Model: every AGENT-engine stage fires an initial automation FOR EACH ENTRY POINT (on-entry
  scripted sequence, agent takes over on reply). **What GTA already had:** `confirm-automations.js`
  (Scheduled Trial) + `closing-automations.js` (Done Trial) = proven scripted, approval+mode-gated,
  `ghl_kpi_config`-stored sequences. Both are single-entry so already "per-entry." **The gap =
  Responded (Booking), the 5-entry hub** — had only an AI cold-opener seeded by "Entry:" notes,
  no scripted sequence. **✅ Phase A built (2026-07-06):** `api/agent/booking-automations.js`
  clones the confirm pattern, keyed by entry point (`new_lead` / `rebook` = no_show+cant_make_it /
  `reengaged` = replied). Exports `DEFAULT_BOOKING_AUTOMATIONS`, `getBookingAutomations(client)`
  (override in `ghl_kpi_config.booking_initial_automations`), `bookingEntryForTrigger(trigger)`,
  `automationsLive(autos, entryKey)`, `nextDueStep(autos, entryKey, {nowMs, startedMs, sentKeys})`.
  **✅ ALL PHASES B-E SHIPPED 2026-07-06 (PR #1189):**
  - **B/C (`agent-approvals.js`):** the booking detector's opener + rebook passes now use the
    academy's SCRIPTED opener via `scriptedBookingOpener(client, entryKey, firstName)` when
    `bookingAutosLive` for that entry (opener pass = `new_lead`, rebook pass = `rebook`), else
    fall back to the AI `draftOpener`. Resolves `{{contact.first_name}}` before queueing (draft
    goes straight to the Hawkeye queue, not the send-engine token pass). Name fetched before
    drafting. approved:false default → GTA byte-identical until approved.
  - **D (`post-trial.js`):** no-show now bounces to **Responded** (router; hardcoded Responded
    fallback) + writes a rebook memory note + an "Entry: Rebook" trigger note the rebook pass
    consumes. **`missed_trial` firing REMOVED** (retired per Zoran); dropped the dead
    enrollContact/isAutomationLive import. THIS IS A LIVE BEHAVIOR CHANGE (no-shows go
    active-rebook, not the nurture path) — verify on GTA.
  - **E (editor):** `agent-approvals.js` `booking-automations-get`/`-set` actions +
    `sanitizeBookingAutomations` (per-entry). `client-portal.html`: the Confirm/Closing "Initial
    automations" editor now renders for the Booking agent too via a separate `_bookingAutosRender`
    path (per entry point), `_CA` is agent-aware (endpoint `/api/agent-approvals` + booking action
    names), `_caToggleEntryStep`. Focus mode: Responded stage gear → Engine → Initial automations
    card shows the 3 entry openers, editable + approvable. Confirm/closing flat editor byte-identical.
  **DECIDED: retire `missed_trial`** (Zoran). **NOTE:** none of B-E prod-verified yet — verify on
  GTA. `reengaged` entry defined but unwired (no caller writes that note; the nurture/ghosted reply
  bounce may be a GHL workflow — Phase C+ once it's portal code). See [[project_client_agent_training]].
- **⏭ OTHER remaining swaps:** `replied` interested/nurture→responded (the ghosted/nurture reply
  bounce — likely a **GHL workflow, not portal code**; confirm before assuming a site) ·
  `enrolls`→member (Stripe payment path — deterministic, low value, probably leave direct) ·
  `marked_unqualified` (manual confirm-abandoned action — from-role-agnostic; probably leave direct).
- **Phase 4:** delete the hardcoded destination resolution once every site routes.

**Other unbuilt engines:** Closing agent, Lead Nurture automation, Resend email (see doc redesign
notes). Core parity BLOCKED (fc-core-srvc inaccessible to `zoran-star`).

**Source-of-truth doc (Figma-style):** `bam-ghl-agent/docs/sales-crew-model.html`.
**Deploy:** push to main → Vercel auto-builds (~3 min); client-portal HTML is public so poll
`curl portal.byanymeansbusiness.com/client-portal.html | grep _plOpenFocus` to confirm live.
Coleman tip: Vercel "Prioritize Production Builds" toggle jumps prod ahead of preview builds.

---


Phase 2 of the V2 Sales-page restructure. Phase 1 (the Sales **overview**: KPI row +
collapsed stage strip + expand/single-stage takeover) is already wired into
`client-portal.html` — see [[project_client_agent_training]] for the agent side.

**What it is:** a per-stage **config** view (distinct from the cards view). Every
Configure / ⚙ gear button (overview cards, single-stage, board) opens that stage's
focus mode — a full-page takeover.

**Model — every pipeline stage = Entry points → Engine → Exit points**

Layout is **stacked** (Entry section, then Engine, then Exit; top-down).

- **Entry points** (view-only, auto-linked): a stage's exit = the next stage's entry.
  Can be: post-trial form · form filled by parent · calendar booked by parent ·
  agent decision · automation step.
- **Exit points** (view-only): post-trial form · agent decision · automation step.
- **Engine** (editable — "everything editable now"), one of:
  - **Automation** → trigger · steps · exit strategy
  - **Agent** → mode toggle (Off/Hawkeye/Self-drive) · initial automations ·
    offer-specific data · learning lessons · test sandbox
  - **Human** → manual, **no config**

**"Initial automations"** = the on-entry triggered sequences (e.g. schedule a trial →
auto-send confirmation + same-day reminder text), separate from the agent's
conversational replies. They live inside the agent engine.

**The chain (auto-link):**
`[ad/form/calendar] → Nurture → Interested → Responded → Scheduled Trial → Done Trial → [Won/Lost]`
Nurture/Interested = automation, Responded/Scheduled/Done = agents (Booking/Confirm/Closing).

**Train Agent folds in:** the standalone Train Agent page (`_TA_*`: sandbox, offer data,
lessons, mode toggle, automations) becomes the **agent engine** section per stage. Goal:
retire the Train Agent nav — "everything lives in focus mode."

**Reuses:** agent engine = existing `_TA_*` UI; automation engine = existing step-builder;
initial automations = confirmation/reminder sequences.

**Phasing:** A) shell + stacked layout + entry/exit chain + engine routing + agent mode
toggle live + embed Train Agent UI · B) full inline editing (initial autos, offer data,
lessons, automation trigger/steps/exit) · C) retire Train Agent nav.

**Status 2026-07-05:** plan confirmed; mockup built; focus mode WIRED into the real
portal (reuses `_taRenderPanel`/`_taRenderAutomations` - real agents/automations) via
`_plOpenFocus`/`_plRenderFocus` in `client-portal.html` (opened by overview-card gear +
single-stage Configure). Engine = live Train Agent renderers. Entry/exit were placeholder
rows - superseded by the real model below.

## ⚠️ REAL entry/exit model (source of truth: `docs/sales-crew-model.html` "The Sales Crew")
NOT a linear chain - it's **hub-and-spoke around Responded (Booking agent)**. Each stage =
ENTRY points -> GOAL -> EXIT branches, composed from a shared, mix-and-match taxonomy.

**Stages/engines:** Responded=Booking agent · Scheduled Trial=Confirm agent (+init automation:
confirmation) · Done Trial=Closing agent (+init automation: post-trial follow-up) ·
Interested=Ghosted automation (aggressive/short) · Nurture=Lead Nurture automation (sparse/long) ·
terminal: Member, Unqualified (dead end, no nurture).

**ENTRY types (all carry context):** new_lead (form/inbound) · rebook (can't-make-it/no-show) ·
nurture_reply · ghosted_reply · booked (from Booking) · good_fit (from post-trial form) ·
went_quiet (->Ghosted) · ghosted_ran_out (->Nurture) · lost_any_stage (->Nurture).

**EXIT branches {trigger -> destination}:** picks-day+time->booked->Confirm · not-interested/
no-longer-wants/says-no->Lost->Nurture · marked-unqualified->Unqualified(dead) · goes-quiet->Ghosted ·
complaint/off-topic->Human · post-trial-form-filled->Trial outcomes · can't-make-it->Booking(rebook) ·
enrolls->Member · replies->Booking (from Ghosted/Nurture).

**Post-trial form = a router:** showed+good-fit->Closing · showed+not-a-fit->Unqualified · no-show->Booking(context).

**Ghosted (Interested):** went-quiet -> nudge d1/d3/d7 -> reply->Booking, silent->Nurture.
**Lead Nurture:** ghosted-ran-out + any Lost (non-unqualified) -> sparse email+text -> reply->Booking.
**Qualification rule (per-academy, in the Brain):** GTA qualified = near Oakville (~30min) + athlete 9+;
fail -> Unqualified. Lives in brain FACT sections (business_info/program/qualification_config).

**Backend taxonomy DESIGNED 2026-07-06 →** [`docs/core-handoff/sales-flow.md`](../../../docs/core-handoff/sales-flow.md)
(ready-for-review). Model = a directed graph of edges: `stage_transition {from_stage_role, trigger,
to_destination}` in a client-scoped table; entry points of a stage = edges landing on it, exits = edges
leaving it. Enums: `stage_role`, `transition_trigger` (base library), `transition_destination` (role or
member/unqualified/human). **Decisions:** soft-no triggers stay DISTINCT (not_interested/no_longer_wants/
says_no); **fully per-academy authorable** (CRUD edges, standard flow = seed; academy-custom triggers =
future condition engine). **BLOCKED:** core review — `fc-core-srvc` inaccessible to `zoran-star`
(grant access / set up checkout for real parity).
**BUILT 2026-07-06:** schema LIVE in prod — migration `20260706122103_stage_transitions` (enums
`transition_trigger`/`stage_role`/`transition_destination_kind` + table `stage_transitions` edge-per-row,
client-scoped RLS, + `seed_default_stage_transitions(client_id)`); **BAM GTA seeded** with the 20-edge
standard flow. **STILL TODO:** backend router that reads edges to move leads (still hardcoded `_stage.js`),
+ focus-mode UI wiring (read/edit edges) — replaces the placeholder entry/exit rows in `_plRenderFocus`.

**Doc viewable at:** `localhost:5184/_sales-crew-model.html` (temp copy of `docs/sales-crew-model.html`; delete before commit).
**Redesign notes in the doc:** Ghosted/Nurture still rigid GHL workflows (rebuild as portal automations);
Closing agent + its automation NOT built yet (SES-025); Resend email system to build; new `unqualified` tag +
"end the lead" logic (Unqualified vs Lead Nurture) per agent; shared follow-up scheduler (all agents).

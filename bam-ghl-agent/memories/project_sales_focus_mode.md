# Sales Focus Mode (V2) — design spec (locked 2026-07-05)

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

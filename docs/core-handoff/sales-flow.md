---
domain: sales-flow
review_state: ready-for-review
prototype_status: partial
core_parity: not-reviewed
last_reviewed: "2026-07-06"
prototype_commit: working-tree
core_commit_reviewed: unavailable
---

# Domain: Sales Flow (entry/exit transitions) — Prototype-to-Core Handoff

## Built (2026-07-06)

- **Schema is LIVE in prod** (project `jnojmfmpnsfmtqmwhopz`, linked migration
  `20260706122103_stage_transitions`): enums `transition_trigger` / `stage_role` /
  `transition_destination_kind`; table `public.stage_transitions` (edge per row,
  client-scoped, RLS `is_staff() OR my_client_ids()`, unique edge constraint, audit
  fields); function `seed_default_stage_transitions(client_id)`.
- **BAM GTA seeded** (`39875f07-0a4b-4429-a201-2249bc1f24df`) with the 20-edge standard
  Sales-Crew flow (matches `docs/sales-crew-model.html`).
- **NOT built yet:** the backend router that READS these edges to move leads (still the
  hardcoded `_stage.js` + per-agent logic), and the focus-mode UI wiring (reads/edits edges).
  Migration file: `bam-portal/supabase/migrations/20260706122103_stage_transitions.sql`.

## Summary

- **What the prototype implements (proposed):** a data-driven **entry/exit-point** system
  for the BAM "Sales Crew" pipeline. Today the flow — which stage a lead moves to on each
  trigger — is **hardcoded** across `api/agent/_stage.js` (role finders) and each agent's
  end-the-lead logic. This design turns it into a **reusable taxonomy** (trigger + destination
  enums) plus a per-academy **`stage_transitions`** table, so academies mix-and-match the flow
  per stage. Entry points of a stage = transitions landing on it; exit points = transitions
  leaving it. Same edges, two views.
- **Intended production direction:** a pipeline **stage-transition-rule** concept in the core
  sales/pipeline domain (a directed graph of {from_stage, trigger} → destination), engine per
  stage (agent | automation | human), provider-neutral stage roles.
- **Suggested core owner:** pipeline / sales-automation domain.

## References

- **Prototype (model of record):** `bam-ghl-agent/docs/sales-crew-model.html` ("The Sales Crew").
- **Prototype (current, hardcoded):** `bam-ghl-agent/bam-portal/api/agent/_stage.js` (role finders:
  responded / interested / scheduled_trial / nurture), the agents (`agent-approvals`/`agent-confirm`/
  `agent-closing`), `api/automations.js` + tables `automations`, `automation_steps`,
  `automation_enrollments`, `automation_jobs`, `automation_events`; `entry_points` table;
  `clients.ghl_kpi_config.portal_entry_routing` (contact_stage / trial_stage / scheduled_stage + bot).
- **Focus-mode UI (consumer):** `client-portal.html` `_plRenderFocus` (entry/exit sections + engine).
- **Core reviewed:** **NONE — `fc-core-srvc` is inaccessible from this environment** (the
  `zoran-star` GitHub account cannot resolve `Full-Control/fc-core-srvc`). Core parity below is
  UNVERIFIED and must be reviewed once access is restored (see `core-service-reference-setup.md`).

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| `stage_role` (enum) | Provider-neutral stage identity | responded · interested · scheduled_trial · done_trial · nurture (+ terminals member · unqualified). Mapped to a GHL/portal stage id via the existing `resolveStage`. **Never** the display name. |
| `stage_engine` (enum) | What works a stage | `agent` (booking/confirm/closing) · `automation` (ghosted/lead_nurture) · `human`. One per stage. |
| `transition_trigger` (enum) | What the lead/coach did | new_lead · replied · went_quiet · booked · cant_make_it · no_show · post_trial_good_fit · post_trial_not_fit · not_interested · no_longer_wants · says_no · enrolls · marked_unqualified · complaint_offtopic · ghosted_ran_out |
| `transition_destination` (enum) | Where they go | a `stage_role` OR a terminal (member · unqualified · human) |
| `stage_transition` (table) | One edge of the flow graph | `id` pk · `client_id` (tenant scope) · pipeline ref · `from_stage_role` · `trigger` · `to_destination` · `enabled` · `carries_context` bool · `created_at`/`updated_at`. Seeded with the standard Sales-Crew flow per academy; owners toggle/remap. |

**Derivations (no separate storage):** a stage's **entry points** = `stage_transition` rows where
`to_destination = <stage_role>`; its **exit points** = rows where `from_stage_role = <stage_role>`.
The backend router replaces the hardcoded moves by reading enabled transitions for `(from_stage, trigger)`.

**The Sales-Crew default edges (seed):**
`responded`: new_lead/replied/nurture_reply/ghosted_reply → in; booked→scheduled_trial · not_interested→nurture(lost) · marked_unqualified→unqualified · went_quiet→interested · complaint→human.
`scheduled_trial`: booked→in; post_trial_form→(router) · cant_make_it→responded · no_longer_wants→nurture · unqualified · complaint→human.
post-trial router: good_fit→done_trial · not_fit→unqualified · no_show→responded.
`done_trial`: good_fit→in; enrolls→member · says_no→nurture · unqualified · complaint→human.
`interested` (Ghosted auto): went_quiet→in; replied→responded · ghosted_ran_out→nurture.
`nurture` (Lead Nurture auto): ghosted_ran_out + any lost(non-unqualified)→in; replied→responded.

## Parity

| Prototype concept | Core mapping | Status | Next action |
|---|---|---|---|
| `stage_role` / `stage_engine` enums | core pipeline/stage model | `decision-needed` | Review core pipeline domain once accessible |
| `stage_transition` edges | core workflow / pipeline-rule | `decision-needed` | Confirm core has (or wants) a transition-rule table vs hardcoded |
| `transition_trigger`/`destination` enums | core enums | `decision-needed` | Align enum values / naming with core |
| `automations`/`automation_steps`/etc. | core automation/sequence model | `partial` | Existing tables predate this; confirm they stay the step store |
| `unqualified` terminal + "end the lead" | core lead lifecycle status | `missing` | New `unqualified` status/tag needed (per doc redesign note) |

## Decisions And Shortcuts

| Item | Reason | Core impact / replacement |
|---|---|---|
| Store transitions as a **table** (not JSON on `ghl_kpi_config`) | queryable by the router; per-guardrails stable PK + audit fields; per-academy toggle | Core can normalize a real edge table 1:1 |
| **Provider-neutral `stage_role`** (map to GHL stage via `resolveStage`) | isolate GHL stage IDs from the durable model | Core stores role; provider id in a mapping/join |
| **Fully per-academy authorable** transitions (CRUD, not just toggle a global seed) | Zoran's call 2026-07-06 — academies compose their own flow | Core: per-tenant authored edges; standard Sales-Crew flow is a seed/starting point, not a locked global |
| **Soft-no triggers stay distinct** (`not_interested`/`no_longer_wants`/`says_no`) | per-stage analytics on WHERE leads say no; same destination (nurture) | Core keeps 3 triggers, 1 destination |
| Ghosted/Nurture still rigid **GHL workflows** today | not yet rebuilt as portal automations | Migration risk: transitions out of those stages fire in GHL, not the portal router, until rebuilt |
| Closing agent + its automation, Lead Nurture, Resend email = **not built** | per the doc (SES-025 + email system) | These destinations exist in the model before the engines do |

## Decided (2026-07-06, Zoran)

- **Soft-no triggers stay DISTINCT** — `not_interested` (Booking) · `no_longer_wants` (Confirm) ·
  `says_no` (Closing). Same destination (nurture); separate triggers so we can report WHERE leads drop.
- **Fully per-academy authorable.** `stage_transitions` rows are **authored per academy** (CRUD),
  not just toggles on a global seed. The standard Sales-Crew flow is a **starting seed** each academy
  can add to / edit / remove. Stages = the academy's own pipeline stages (each assigned an engine).
  Implication: `transition_trigger` is a **BAM base library** of system-detectable events (the agents/
  automations/forms/calendar produce them); **academy-custom triggers** (tag/condition-based) are a
  **future extension** that needs a small condition engine — flagged, NOT in v1. Authoring freedom in
  v1 = compose edges from the base triggers + academy stages, assign the engine, enable/disable.

## Open Decisions

- Core review is **blocked** on `fc-core-srvc` access from this environment — parity table unverified.
  (Grant `zoran-star` access to `Full-Control/fc-core-srvc`, or set up the read-only checkout.)
- Per-academy authoring raises a consistency risk: the backend router + agents must handle any
  `{from_stage, trigger} → destination` an academy composes. Need guardrails so an academy can't author
  a flow the engines can't execute (e.g. a trigger no engine emits at that stage). Design in build phase.

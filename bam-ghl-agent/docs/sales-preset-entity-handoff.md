# Handoff: July 21 meeting session → the shared sales-preset entity build

**Written 2026-07-22 by the "Sembly meeting notes" session (branch `claude/sembly-meeting-notes-ef4c65`, PR #1548).**
Audience: the session building the **sales system preset as its own shared entity** (one preset shared by academies; update it once, every academy gets the update). This doc tells you what that session shipped, what it deliberately left FOR YOU, and what your plan needs to absorb.

---

## 1. What already shipped (PR #1548, 4 commits - may still be unmerged, check first)

All from Zoran's 2026-07-21 team-meeting walkthrough of the free-trial sales preset:

1. **Preset sweep** - the `free_trial` preset corrected to Zoran's spoken spec:
   - 3 new edges: `scheduled_trial --cancel_booking--> responded` (wired from website manage-booking cancel + parent-app cancel, with the rebook-note handshake via new `api/agent/_rebook.js`), `done_trial --ghosted_ran_out--> nurture` (ghosts all closing follow-ups), `nurture --ghosted_ran_out--> @unqualified` (whole nurture sequence dry = exits pipeline; replaced the old terminal-Lost roll).
   - **Contact entry point → Responded** (was wrongly landing contact-form leads in the Ghosted stage; seed + prod backfill in migration).
   - **"Interested" renamed to "Ghosted"** in every person-facing label. Internal role key is STILL `interested` - do not rename the enum. Stage-name matchers widened to `/interest|ghost/i`.
   - **Qualifications block added to the preset**: location / athlete age / program fit. "Interested in basketball" is NOT a qualification anymore.
   - Config-view copy: no-show entry credits the post-trial form, good-fit exit reads "+ showed up", the ghosted→nurture hand-off is communicated ONCE (exit point only, engine panel suppresses its copy in focus mode).
2. **Opt-out compliance fix** - all 3 agents can now suggest **mark unqualified** (card kinds `mark_unqualified` / `confirm_unqualified` / `closing_unqualified`); opt-out phrases never map to Lost (Lost was re-enrolling opted-out leads into nurture texting); soft opt-out regex on both inbound webhooks writes a persistent contact note.
3. **Home-screen X** on automation-stage rows: exits all automations (`exit-enrollment` action) + drops the card as plain `abandoned` - deliberately NO unqualified tag.
4. **Onboarding wizard V2 design pass** + Coach IQ ties buried from pricing options (`_CIQ_BURY_PRICING` flag).

**3 migrations ride the PR and must be applied to live Supabase on merge:**
`20260721120000_cancel_booking_trigger_value.sql`, `20260721121000_cancel_booking_ran_out_edges.sql`, `20260722120000_unqualified_card_kinds.sql`.

Memory notes with the full detail: `bam-ghl-agent/memories/project_preset_sweep_2026_07_21.md`, `project_optout_unqualified_flow.md`.

## 2. Hard rules Zoran locked (your entity must encode these)

- **Unqualified = the ONE dead end.** Removed from the pipeline entirely, never contacted again. Marking unqualified ALWAYS requires a criteria pick (too far / age out of range / not a fit / other - the preset's qualifications). Board modal enforces this; Hawkeye one-tap buttons don't yet (known follow-up).
- **Not interested / lost = Nurture, never unqualified.** Any place that says "mark as lost" routes to the nurture stage.
- **Ghosted drip cadence = day 1 / 2 / 3. The engine is the source of truth** over any doc/UI label.
- Each pipeline stage = **entry points + engine + exit points**; the flow graph lives in `stage_transitions` rows and the config view renders live from them.
- Every automation hand-off is communicated in the EXIT point only, not duplicated in the engine.

## 3. The current per-academy model (what you are replacing)

- Presets are **authored in code**: `bam-portal/api/agent/presets.js` (`PRESETS.free_trial` - 5 stages, 23 edges after the sweep; also `discovery_trial`). **No presets table, no authoring UI.**
- Applying = **copy-stamping**: `buildPresetRows()` / `applyPreset()` write per-client `pipeline_stages` + `stage_transitions` rows; `api/offers/apply-preset.js` is the API (preview + 409 `needs_force` force-replace); `offers.data.sales.preset_key` gets stamped. UI: `_bbPresetPreview/_bbPresetApply` (Sales section) and `_obfApplyPreset` (wizard one-click: preset → seed automations → sync agent → seed entry points).
- Consequence: after a stamp, academies drift - exactly what the shared entity fixes. **Design question for you:** when the shared preset updates, what happens to an academy's own edge edits (the Exit editor lets academies author edges)? Zoran wants "update once, all academies update" - you need an answer for the override/merge story (derive-at-read vs sync-on-update, and whether per-academy overrides survive entity updates).

## 4. Live-DB findings you should know (checked 2026-07-22, read-only)

- **GTA** = the reference: full 5-role pipeline, the preset was reverse-engineered from it byte-for-byte.
- **Detail Miami** (client `4708a68d-5365-48bf-a404-72a69fadd34d`, Training offer `7d82f15e-db2e-45e5-9f22-9de86ff88254`):
  - Only **4 stages** (no `nurture`), hand-seeded 2026-07-08 pre-preset-system.
  - Its ghost stage row uses **role `ghosted`**, not `interested` - a preset/entity apply would create a duplicate stage unless that row is renamed first (1-row UPDATE).
  - **ZERO `stage_transitions` rows** - agents run purely on hardcoded fallbacks.
  - The offer is stamped `preset_key: free_trial` **but it was never actually applied** (demo prefill; `preset_applied_at` is null) - so setup-status shows the preset step done when it is not. Distrust the stamp.
- **Per Zoran: do NOT per-academy-apply anything to Detail** - Detail gets the sales system via your shared entity when it lands.

## 5. Deferred TO you (Zoran explicitly routed these to the entity work)

1. **Detail Miami gets the sales preset** via the entity (see §4 for the pre-apply gotchas).
2. **The context ↔ onboarding editing loop** (Sembly notes #4/#5): every agent-context piece (schedule, business info, offer, program, coaches, selling points) tagged **global vs academy**; config shows where each piece is tied (e.g. "schedule → the schedule set in onboarding") and click-through jumps to its editor. Academy pieces should be DERIVED from structured data so editing in onboarding updates agents automatically; global pieces = the shared brain that updates all academies - same propagation pattern as your preset entity, so design them as one system.
3. **Entry-point funnel ties in config** (Sembly note #1): the lead-form entry point should display which funnel feeds it, in the sales pipeline configurations.

## 6. Rundowns produced (ask the Sembly session or re-derive; short versions)

- **Quiet lead**: booking-agent nudges retired 2026-07-08; 24h quiet → human-approved "Send to Ghosted" card → Ghosted drip (day 1/2/3) → dry → Nurture (+7/14/21d) → dry → now exits as unqualified. Any reply bounces to Responded.
- **Booking → Scheduled Trial**: 3 entry paths converge on the `booked` edge; scripted confirm = instant SMS+email confirmation + 9am same-day check-in (a `day_before` slot exists unused); confirm agent shares the contact's thread + notes; can't-make-it hands back via note handshake + `cant_make_it` edge.
- **No-show rebook**: post-trial form (showed up? → fit? / no-show reason + seed text) → `no_show` edge back to Responded → booking agent drafts a context-aware rebook opener (scripted opener variant is generic - known gap).

## 7. Practical pointers

- Branch/PR: `claude/sembly-meeting-notes-ef4c65` → PR #1548. If unmerged, this doc + all §1 code is only on that branch.
- Key files: `api/agent/presets.js`, `api/offers/apply-preset.js`, `api/agent/_router.js` (`routeTransition`), `api/agent/_rebook.js`, `supabase/migrations/20260706122103_stage_transitions.sql` + the 3 PR migrations, `scripts/apply-preset.mjs`.
- The stage_transitions edge unique is `NULLS NOT DISTINCT`; seed function is `seed_default_stage_transitions` (kept in sync with presets.js by hand - your entity should kill this duplication).

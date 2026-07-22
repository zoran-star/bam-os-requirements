# Free-trial preset sweep (2026-07-21 team meeting)

PR #1548. All the sales-preset corrections from Zoran's July 21 walkthrough with the systems team (Sembly notes), shipped in one sweep.

## The decisions (Zoran's hard rules)
- **Unqualified = exits the pipeline entirely** (terminal). **Not interested = Nurture, NEVER unqualified.** "Interested in basketball" is NOT a qualification anymore.
- Qualifications for the free-trial preset: **location (near academy) / athlete age / program fit**. First two are collected on the live free-trial form (bam-client-sites `freetrial.jsx` asks age + "Are you close to Oakville?").
- Marking unqualified ALWAYS requires picking a criteria (too far / age out of range / not a fit / other) - board modal enforces it. ⚠️ Hawkeye one-tap Unqualified buttons don't enforce it yet (needs API change - follow-up).
- Ghosted drip cadence = **day 1/2/3, engine is source of truth** (docs said 1/3/7, fixed).
- The "Interested" stage is now displayed as **"Ghosted"** everywhere person-facing. Internal role key stays `interested`. Stage matchers accept `/interest|ghost/i`.

## New flow edges (presets.js + migrations 20260721120000 + 20260721121000)
- `scheduled_trial --cancel_booking--> responded` - lead cancels booked trial (website manage-booking link or parent app) → rebook handshake (shared helper `api/agent/_rebook.js`)
- `done_trial --ghosted_ran_out--> nurture` - ghosts all closing follow-ups (fires on Hawkeye confirm-lost approval)
- `nurture --ghosted_ran_out--> @unqualified` - whole nurture sequence runs dry, no reply → exits pipeline (was terminal Lost)
- **Contact entry point → Responded** (was wrongly parking contact-form leads in Ghosted; seed + prod backfill)

## Gotchas
- Preset compiles to 5 stages + 23 edges. Presets are authored in `api/agent/presets.js` - no presets table.
- Migrations must be applied to live Supabase ON MERGE of PR #1548 (deliberately not applied before).
- Ghosted→Nurture hand-off note now shows ONCE in focus mode (exit point only, engine panel suppresses it via `_PL_FOCUS`).

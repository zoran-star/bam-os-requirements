# San Jose (Lij) onboarding: build queue

Live queue of everything the San Jose onboarding surfaces. Onboarding spans days and sessions, so this file is the memory, not the session task list.

**Started 2026-07-25.**

---

Team roster, spawn prompts and gate mechanics: [lij-onboarding-team-playbook.md](lij-onboarding-team-playbook.md).

---

## The triage rule

Every gap found during onboarding gets exactly one severity BEFORE anyone proposes work:

| Severity | Meaning | Action |
|---|---|---|
| **BLOCKER** | San Jose cannot onboard correctly, or GTA content leaks to SJ leads | Build now |
| **FRICTION** | SJ can onboard, but a human does something manual or ugly | Queue, batch later |
| **SCALE** | Only bites at academy #3 or later | Backlog note only |

Without this, every find feels urgent and the academy never actually gets onboarded.

## The guardrail on every fix

Sales systems are **shared**. Never fork one academy's structure. If one client needs X, either every academy gets X, or X is a runtime fact (domain, owner, program names, prices, age ranges, location). An `if academy == gta` branch is always the wrong answer.

## How work moves

```
gap found -> triage -> [BLOCKER only] -> planner (mockup + diagram)
  -> GATE 1: Zoran workshops and approves
  -> builder (own worktree)  <-> tester (bounces fixes back)
  -> GATE 2: Zoran runs the plain-English test script
  -> merge -> back to onboarding
```

Fable plans. Opus builds and tests.

## Prior art: read before proposing anything preset-shaped

- [sales-preset-entity-handoff.md](../bam-ghl-agent/docs/sales-preset-entity-handoff.md) - the plan to make presets ONE shared entity instead of per-academy stamping
- [project_preset_sweep_2026_07_21.md](../bam-ghl-agent/memories/project_preset_sweep_2026_07_21.md) - Zoran's locked preset rules, plus the standing warning not to build preset-shaped work separately

---

## Queue

Scout sweep completed 2026-07-25. Every row has file:line evidence in the Scout report (session 153b68ad). Key context: the fix handoff `bam-ghl-agent/docs/build-handoffs/preset-automations-canonical-no-hardcode.md` referenced in memory **was never committed** - the folder does not exist. Items 1-3 below are what it scoped.

| # | Item | Severity | Status | Notes |
|---|---|---|---|---|
| 1 | Outbound identity seam: `LOCATIONS` map in `email-shells.js:79-95` falls back to GTA (site, Oakville, instagram, email) for every other academy | BLOCKER | queued | One build with #2 and #3. Fix = derive identity from the client row, fail loud instead of falling back to GTA |
| 2 | "coach Zoran" + Oakville merge-token leak; empty domain resolves to byanymeanstoronto.ca (`email-shells.js:118-121`, `automations.js:501-507`) | BLOCKER | queued | Part of the #1 build |
| 3 | All automation emails send FROM `info@byanymeanstoronto.ca` (`_email.js:18`, `_send.js:33-35`); only the human 1:1 lane uses per-academy from | BLOCKER | queued | Part of the #1 build |
| 4 | Trial confirmations render times in `America/Toronto` for every academy (`agent/confirm-automations.js:21`); SJ 5pm PT trial reads 8pm | BLOCKER | queued | `_quiet.js` already does per-academy tz right; adopt the same pattern |
| 5 | Agent brain GTA fallbacks: `social_proof` = GTA reviews link; no Training offer = whole brain (Oakville address, GTA schedule/prices) falls back to GTA text (`prompt-structure.js:85-127`, `fact-render.js:277-279`) | BLOCKER | queued | Mechanism partly covered by entity handoff §5; the no-offer hole is in neither doc. Check if SJ has an `agent_prompt_sections` override for social_proof before building |
| 6 | Funnel form is a per-site GTA copy: GTA client_id baked as fallback (`freetrial.jsx:475,557,576`), "close to Oakville?" field, ages 5-19, GTA email in copy. Lives in bam-client-sites | BLOCKER | queued | A copied site missing config silently pumps leads into GTA's pipeline. No SJ folder exists yet |
| 7 | Seeded drip copy diverges from GTA's proven copy; API/script preset apply doesn't seed drips at all (wizard chain does) | FRICTION | queued | `form-intro-automations.js:32-136`, `apply-preset.js` |
| 8 | Designed nurture + onboarding email templates are hard-baked GTA HTML, not tokenized (`nurture-emails.js`, `onboarding-emails.js:47-133`) | FRICTION | queued | Blocks "promote GTA copy into defaults" until tokenized |
| 9 | Signed legal agreement falls back to GTA wording when offer's Policy step empty (`agreement-pdf.js:25,30`) | FRICTION | queued | `buildClauses()` is parameterized, only the fallback leaks |
| 10 | Quiet-hours default tz = Toronto when `clients.time_zone` unset (`agent/_quiet.js:9,44-47`) | FRICTION | queued | Per-academy override works; null default only |
| 11 | GTA is `DEFAULT_CLIENT_ID` in 5 agent endpoints (approvals, confirm, closing, followups, sandbox) | SCALE | backlog | Fallback-only today, foot-gun at academy #3+ |
| 12 | `members/intake.js` hardwired to GTA (`:23,79,93,103,144`) | SCALE | backlog | Adjacent to, not inside, the preset |
| 13 | Stage positions still copied per-academy at apply time; master reorder needs re-apply | SCALE | backlog | Labels solved 07-24 via `masterStageLabels`; positions flagged in plug-and-play memory |

**Already done properly, do not rebuild:** preset stages/edges runtime-read from master; `seed-entry-points.js` fully manifest-driven; the 8 agent facts render live (incl. qualification values, "near Oakville" default already killed); quiet hours per-academy when tz set; master stage labels propagate.

**San Jose runtime values already captured:** owner "Elijah De Guzman", domain byanymeanssanjose.com (confirm registration before sends).

## Done

_nothing yet_

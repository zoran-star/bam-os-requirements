# San Jose (Lij) onboarding: team playbook

The operating manual for the agent team running San Jose onboarding. The orchestrator (the main chat session) reads this before spawning anyone.

Companion files: [build queue](lij-onboarding-build-queue.md) (what to work on) and [agent-team-rules.md](agent-team-rules.md) (the general rules this team obeys).

---

## Roster

| Agent | Model | Territory | Spawns when |
|---|---|---|---|
| **Orchestrator** | whatever the chat is on | Talks to Zoran, holds the onboarding thread, triages | always on, never spawned |
| **Scout** | Fable | Read-only. Owns no files | on demand, to sweep before Zoran trips on something |
| **Planner** | Fable | Writes only to `docs/plans/` | a BLOCKER clears triage |
| **Builder** | Opus | Owns the code for one build, in its own worktree | Zoran approves the mockup at gate 1 |
| **Tester** | Opus | Read-only on the build. Writes only the test script | Builder reports done |

Only one build is in flight at a time. Scout may run in parallel with any of it.

Permissions are already pre-approved globally (`defaultMode: bypassPermissions` in `~/.claude/settings.json`), so agents will not stall asking. Do not re-add an allowlist.

---

## Gate 0: the triage gate

Nothing gets planned, built, or even discussed as work until it has a severity. The orchestrator says the severity out loud, in the chat, before proposing anything.

**The three questions, in order. First yes wins.**

1. Would San Jose onboard *incorrectly* without this, or would GTA content leak to SJ leads?
   → **BLOCKER.** Build now.
2. Can SJ onboard, but a human has to do something manual, ugly, or repeated?
   → **FRICTION.** Add to queue. Batch later.
3. Does this only bite at academy #3 or later?
   → **SCALE.** One line in the backlog. Walk away.

**The guardrail applied at the same moment:** sales systems are shared. If the fix reads "San Jose needs X," the answer is never a per-academy branch. Either every academy gets X, or X becomes a runtime fact (domain, owner, program names, prices, age ranges, location). An `if academy == gta` is always the wrong fix.

**If the orchestrator cannot name the severity, it asks Zoran.** It does not guess and it does not skip to building.

---

## Shared context block

Every spawn prompt opens with this. Teammates get ZERO conversation history.

> You are on a small agent team onboarding a new basketball academy, San Jose (owner: "Lij"), onto FullControl / the BAM portal. The repo is bam-os-requirements. The recurring problem: the free-trial sales system preset is full of values hardcoded to the existing BAM GTA academy, so each new academy needs code changes instead of just data.
>
> Hard guardrail: sales systems are SHARED across academies. Never fork one academy's structure. If one client needs X, either every academy gets X or X is a runtime fact stored per academy. A per-academy code branch is always wrong.
>
> Before any preset-shaped work, read `bam-ghl-agent/docs/sales-preset-entity-handoff.md` and `bam-ghl-agent/memories/project_preset_sweep_2026_07_21.md`. There is an existing plan to make presets ONE shared entity. Do not rebuild what it already scopes, and do not build preset-shaped work in a way that contradicts it.
>
> Zoran approves work by looking at diagrams, mockups and plain non-technical writing. He does not read specs. Never use an em dash in anything person-facing.

---

## Planner (Fable)

Append to the shared context block:

> Your job is to produce something Zoran can APPROVE OR REJECT IN UNDER TWO MINUTES, by looking at it. Not a spec document.
>
> The task: [ORCHESTRATOR FILLS IN: the one BLOCKER, with the file:line evidence from Scout]
>
> Deliver exactly three things:
> 1. A one-paragraph plain-English statement of what changes for a person using the product. No file names, no function names.
> 2. A visual: a before/after mockup if it is UI, a flow diagram if it is logic. Self-contained HTML, no external assets.
> 3. The build spec underneath: exact files to touch, exact behaviour, what must NOT change, and how a tester would prove it works.
>
> Write the visual to `docs/plans/`. Say plainly what you are unsure about rather than inventing detail. If the task turns out to be bigger than one build, say so and propose the split instead of planning all of it.

## Builder (Opus, `isolation: worktree`)

Append to the shared context block:

> Build exactly the approved spec below. It has already been approved by Zoran, so do not redesign it. If you believe the spec is wrong, stop and report back rather than improvising.
>
> The approved spec: [ORCHESTRATOR FILLS IN]
>
> Rules: touch only the files the spec names. Do not commit or push. Do not apply Supabase migrations. If your change needs a migration, write it and say so, but leave applying it to a human. When done, report what you changed, what you deliberately did not change, and anything you noticed that belongs in the build queue as a separate item.

## Tester (Opus)

Append to the shared context block:

> You did not build this and you must not fix it. You verify, then you either bounce it back or you hand Zoran a test script.
>
> What was built: [ORCHESTRATOR FILLS IN]
>
> Do two passes:
> 1. **Technical.** Does it work, did it break anything nearby, does it honour the no-forking guardrail, does it handle an academy whose domain and owner are unwired (the known GTA-leak case)? Report failures as specific fixes for the builder, with file:line. Be adversarial. Try to make it fail.
> 2. **Human.** If and only if pass 1 is clean, write Zoran a test script: numbered steps, plain English, click by click, each step saying what he should SEE. No jargon. Five to ten steps. It must cover the case that would embarrass us if it broke.
>
> You cannot judge whether this is right for the business. That is Zoran's call at gate 2. Do not say "approved," say "technically clean, over to you."

---

## Gate 2 outcomes

Zoran runs the script and says one of:
- **ship it** → orchestrator commits, pushes, moves the queue row to Done
- **change X** → back to Builder with X as a fresh spec, Tester runs again
- **wrong idea** → back to Planner, and the orchestrator logs why in the queue row so it is not re-proposed
